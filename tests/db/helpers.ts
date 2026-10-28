import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { inject } from "vitest";

export type ClinicRole = "owner" | "manager" | "receptionist" | "cashier" | "doctor";
export type MembershipStatus = "active" | "suspended" | "deactivated";
export type ApiRole = "anon" | "authenticated" | "service_role";

let pool: Pool | undefined;

/** Superuser pool: bypasses RLS. Use only for fixtures and assertions about raw state. */
export function adminPool(): Pool {
  pool ??= new Pool({ connectionString: inject("testDbUrl"), max: 4 });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/**
 * Runs `fn` inside a transaction as a Supabase API role, with JWT claims set
 * the way PostgREST sets them. The transaction is always rolled back, so each
 * call starts from the fixture state.
 */
export async function as<T>(
  role: ApiRole,
  userId: string | null,
  fn: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await adminPool().connect();
  try {
    await client.query("begin");
    const claims = userId ? { sub: userId, role } : { role };
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await client.query(`set local role ${role}`);
    return await fn(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

export const asUser = <T>(userId: string, fn: (db: PoolClient) => Promise<T>) =>
  as("authenticated", userId, fn);

export const asAnon = <T>(fn: (db: PoolClient) => Promise<T>) => as("anon", null, fn);

export async function createUser(label: string): Promise<string> {
  const id = randomUUID();
  await adminPool().query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)",
    [id, `${label}.${id.slice(0, 8)}@example.test`, { full_name: `Synthetic ${label}` }],
  );
  return id;
}

export async function createClinic(
  name: string,
  state: "pending" | "active" | "suspended" | "closed" = "active",
): Promise<string> {
  const { rows } = await adminPool().query<{ id: string }>(
    "insert into public.clinics (name, account_state) values ($1, $2) returning id",
    [name, state],
  );
  return rows[0].id;
}

export async function addMember(
  clinicId: string,
  userId: string,
  role: ClinicRole,
  status: MembershipStatus = "active",
): Promise<string> {
  const { rows } = await adminPool().query<{ id: string }>(
    `insert into public.clinic_memberships (clinic_id, user_id, role, status)
     values ($1, $2, $3, $4) returning id`,
    [clinicId, userId, role, status],
  );
  return rows[0].id;
}

/** Expects `promise` to fail with a PostgreSQL error whose message matches `pattern`. */
export async function expectPgError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let error: unknown;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  if (!error) throw new Error(`Expected a database error matching ${pattern}, but the query succeeded`);
  const message = (error as Error).message;
  if (!pattern.test(message)) {
    throw new Error(`Expected database error matching ${pattern}, got: ${message}`);
  }
}
