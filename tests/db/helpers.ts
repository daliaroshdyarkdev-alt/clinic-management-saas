import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { inject } from "vitest";

export type ClinicRole = "owner" | "manager" | "receptionist" | "cashier" | "doctor";
export type MembershipStatus = "active" | "suspended" | "deactivated";
export type ApiRole = "anon" | "authenticated" | "service_role";

let pool: Pool | undefined;

/** Superuser pool: bypasses RLS. Use only for fixtures and assertions about raw state. */
export function adminPool(): Pool {
  pool ??= new Pool({ connectionString: inject("testDbUrl"), max: 16 });
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
export async function as<T>(role: ApiRole, userId: string | null, fn: (db: PoolClient) => Promise<T>): Promise<T> {
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

export const asUser = <T>(userId: string, fn: (db: PoolClient) => Promise<T>) => as("authenticated", userId, fn);

/** Runs `fn` as an API role and commits (multi-step workflows and concurrency tests). */
export async function asCommitted<T>(
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
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export const asUserCommitted = <T>(userId: string, fn: (db: PoolClient) => Promise<T>) =>
  asCommitted("authenticated", userId, fn);

export const asAnon = <T>(fn: (db: PoolClient) => Promise<T>) => as("anon", null, fn);

export async function createUser(label: string, options: { confirmed?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await adminPool().query(
    "insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ($1, $2, $3, $4)",
    [id, emailOf(label, id), { full_name: `Synthetic ${label}` }, options.confirmed === false ? null : new Date()],
  );
  return id;
}

/** Deterministic synthetic email for a user created by createUser. */
export function emailOf(label: string, id: string): string {
  return `${label}.${id.slice(0, 8)}@example.test`;
}

export async function emailFor(userId: string): Promise<string> {
  const { rows } = await adminPool().query<{ email: string }>("select email from auth.users where id = $1", [userId]);
  return rows[0].email;
}

export async function makePlatformAdmin(userId: string): Promise<void> {
  await adminPool().query("insert into public.platform_admins (user_id) values ($1)", [userId]);
}

/** Simulates a file already uploaded to Supabase Storage. */
export async function putStorageObject(bucket: string, name: string): Promise<void> {
  await adminPool().query("insert into storage.objects (bucket_id, name) values ($1, $2)", [bucket, name]);
}

export async function currentDisclaimerId(): Promise<string> {
  const { rows } = await adminPool().query<{ id: string }>(
    "select id from public.legal_disclaimer_versions where is_current",
  );
  return rows[0].id;
}

export async function createClinic(
  name: string,
  state: "pending" | "active" | "suspended" | "closed" = "active",
): Promise<string> {
  const { rows } = await adminPool().query<{ id: string }>(
    "insert into public.clinics (name, account_state) values ($1, $2) returning id",
    [name, state],
  );
  if (state !== "pending") {
    // Activated clinics always have a subscription row (trial started at activation).
    await adminPool().query(
      "insert into public.clinic_subscriptions (clinic_id, trial_started_at, trial_ends_at) values ($1, now() - interval '90 days', now() + interval '13 days')",
      [rows[0].id],
    );
  }
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
