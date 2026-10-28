// Guard rails that apply to every future migration (CLAUDE.md: "Every new
// exposed table must have explicit grants and Row Level Security policies").
import { afterAll, describe, expect, it } from "vitest";
import { adminPool, closePool } from "./helpers";

afterAll(closePool);

describe("schema guard rails", () => {
  it("every table in the exposed schema has RLS enabled", async () => {
    const { rows } = await adminPool().query<{ table: string }>(
      `select c.relname as table
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it("anon has no privileges on any table, view, sequence or function in public", async () => {
    const tables = await adminPool().query(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'anon'`,
    );
    expect(tables.rows).toEqual([]);

    const sequences = await adminPool().query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'S'
          and exists (select 1 from aclexplode(c.relacl) a where a.grantee = 'anon'::regrole)`,
    );
    expect(sequences.rows).toEqual([]);

    const functions = await adminPool().query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')`,
    );
    expect(functions.rows).toEqual([]);
  });

  it("authenticated never holds DELETE or TRUNCATE on public tables", async () => {
    const { rows } = await adminPool().query(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'authenticated'
          and privilege_type in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')`,
    );
    expect(rows).toEqual([]);
  });

  it("SECURITY DEFINER functions pin search_path and are not executable by anon", async () => {
    const { rows } = await adminPool().query<{ name: string; config: string[] | null; anon: boolean }>(
      `select n.nspname || '.' || p.proname as name, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef and n.nspname in ('public', 'private')`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const fn of rows) {
      expect(fn.config ?? [], fn.name).toContain('search_path=""');
      expect(fn.anon, fn.name).toBe(false);
    }
  });

  it("the private schema is not usable by anon", async () => {
    const { rows } = await adminPool().query<{ usable: boolean }>(
      "select has_schema_privilege('anon', 'private', 'USAGE') as usable",
    );
    expect(rows[0].usable).toBe(false);
  });
});
