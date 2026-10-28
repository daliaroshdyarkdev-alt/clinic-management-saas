import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

/**
 * Creates a throw-away PostgreSQL database, loads the Supabase emulation shim
 * (docs/OPEN_DECISIONS.md OD-E03) and applies every migration in order.
 *
 * TEST_DB_ADMIN_URL must point at a superuser connection on a disposable
 * server, e.g. postgres://postgres:postgres@127.0.0.1:5432/postgres.
 */
export default async function setup(project: TestProject) {
  const adminUrl = process.env.TEST_DB_ADMIN_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";
  const dbName = `clinic_saas_test_${process.pid}`;

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName}`);
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const testUrl = url.toString();

  const db = new Client({ connectionString: testUrl });
  await db.connect();
  const root = process.cwd();
  await db.query(await readFile(path.join(root, "supabase/tests/shim/supabase_shim.sql"), "utf8"));
  const migrationsDir = path.join(root, "supabase/migrations");
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    try {
      await db.query(await readFile(path.join(migrationsDir, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  await db.end();

  project.provide("testDbUrl", testUrl);

  return async () => {
    const cleanup = new Client({ connectionString: adminUrl });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${dbName} with (force)`);
    await cleanup.end();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    testDbUrl: string;
  }
}
