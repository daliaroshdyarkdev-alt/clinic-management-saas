import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
const SHIM_FILE = path.join(__dirname, "shim/supabase_shim.sql");

/** Admin connection string for a disposable PostgreSQL server (never production). */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export type TestDatabase = {
  name: string;
  url: string;
  connect: () => Promise<Client>;
  drop: () => Promise<void>;
};

/**
 * Creates a fresh database, applies the Supabase shim (plain PostgreSQL only)
 * and every migration in order. Each test file gets its own database, so tests
 * never share state and never touch a developer's real data.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  if (!TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is not set");
  }
  const name = `cms_test_${randomBytes(6).toString("hex")}`;
  const admin = new Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }

  const url = withDatabase(TEST_DATABASE_URL, name);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    if (process.env.TEST_DATABASE_IS_SUPABASE !== "true") {
      await client.query(readFileSync(SHIM_FILE, "utf8"));
    }
    for (const file of listMigrationFiles()) {
      await client.query(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    }
  } finally {
    await client.end();
  }

  return {
    name,
    url,
    connect: async () => {
      const c = new Client({ connectionString: url });
      await c.connect();
      return c;
    },
    drop: async () => {
      const c = new Client({ connectionString: TEST_DATABASE_URL });
      await c.connect();
      try {
        await c.query(`drop database if exists ${name} with (force)`);
      } finally {
        await c.end();
      }
    },
  };
}

export type JwtClaims = { sub?: string; role: "anon" | "authenticated" } & Record<string, unknown>;

/**
 * Runs `fn` inside a transaction as an API role with the given JWT claims, the
 * way PostgREST does, then rolls back. Use this for every RLS allow/deny test.
 */
export async function asRole<T>(client: Client, claims: JwtClaims, fn: (c: Client) => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await client.query(`set local role ${claims.role === "anon" ? "anon" : "authenticated"}`);
    return await fn(client);
  } finally {
    await client.query("rollback");
  }
}
