import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, createTestDatabase, listMigrationFiles, TEST_DATABASE_URL, type TestDatabase } from "./harness";

describe.skipIf(!TEST_DATABASE_URL)("security baseline migration", () => {
  let db: TestDatabase;
  let client: Client;

  beforeAll(async () => {
    db = await createTestDatabase();
    client = await db.connect();
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    await db?.drop();
  });

  it("names migrations with a sortable UTC timestamp prefix", () => {
    for (const file of listMigrationFiles()) {
      expect(file).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    }
  });

  it("stores timestamps in UTC for new sessions", async () => {
    const fresh = await db.connect();
    try {
      const { rows } = await fresh.query<{ timezone: string }>("select current_setting('TimeZone') as timezone");
      expect(rows[0]?.timezone).toBe("UTC");
    } finally {
      await fresh.end();
    }
  });

  it("does not grant API roles access to tables created after the baseline", async () => {
    await client.query("create table public.probe_table (id int primary key)");
    try {
      const { rows } = await client.query<{ role: string; allowed: boolean }>(`
        select r.role, has_table_privilege(r.role, 'public.probe_table', 'select,insert,update,delete') as allowed
        from (values ('anon'), ('authenticated')) as r(role)
      `);
      expect(rows).toEqual([
        { role: "anon", allowed: false },
        { role: "authenticated", allowed: false },
      ]);

      await expect(
        asRole(client, { role: "authenticated", sub: "00000000-0000-4000-8000-000000000001" }, (c) =>
          c.query("select * from public.probe_table"),
        ),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await client.query("drop table public.probe_table");
    }
  });

  it("does not let API roles execute functions created after the baseline", async () => {
    await client.query("create function public.probe_fn() returns int language sql as 'select 1'");
    try {
      const { rows } = await client.query<{ role: string; allowed: boolean }>(`
        select r.role, has_function_privilege(r.role, 'public.probe_fn()', 'execute') as allowed
        from (values ('anon'), ('authenticated')) as r(role)
      `);
      expect(rows.every((row) => !row.allowed)).toBe(true);
    } finally {
      await client.query("drop function public.probe_fn()");
    }
  });

  it("keeps the private schema closed to API roles", async () => {
    const { rows } = await client.query<{ role: string; allowed: boolean }>(`
      select r.role, has_schema_privilege(r.role, 'private', 'usage') as allowed
      from (values ('anon'), ('authenticated')) as r(role)
    `);
    expect(rows.every((row) => !row.allowed)).toBe(true);
  });

  // Standing guard for every future migration: no exposed table without RLS.
  it("has Row Level Security enabled on every table in the public schema", async () => {
    const { rows } = await client.query<{ table_name: string }>(`
      select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
    `);
    expect(rows).toEqual([]);
  });
});
