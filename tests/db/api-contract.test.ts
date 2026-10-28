// Until generated Supabase types are available (they need the local Supabase
// stack), this test keeps application queries honest: every `.rpc()` call
// must name an existing function with exactly the arguments passed, and every
// column in `.from(table).select(...)` must exist and be readable by the
// `authenticated` role.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { adminPool, closePool } from "./helpers";

afterAll(closePool);

const SOURCE_DIRS = ["app", "modules", "lib", "components"];

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries.map((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return sourceFiles(full);
      return Promise.resolve(/\.(ts|tsx)$/.test(e.name) ? [full] : []);
    }),
  );
  return files.flat();
}

async function allSource(): Promise<{ file: string; text: string }[]> {
  const files = (await Promise.all(SOURCE_DIRS.map((d) => sourceFiles(path.join(process.cwd(), d))))).flat();
  return Promise.all(
    files.map(async (file) => ({ file: path.relative(process.cwd(), file), text: await readFile(file, "utf8") })),
  );
}

/** Parses "a, b, alias:table!inner(c, d)" into plain columns and embeds. */
function parseSelect(select: string): { columns: string[]; embeds: { table: string; columns: string[] }[] } {
  const columns: string[] = [];
  const embeds: { table: string; columns: string[] }[] = [];
  const embedRe = /(?:\w+:)?(\w+)(?:!\w+)?\(([^)]*)\)/g;
  for (const match of select.matchAll(embedRe)) {
    embeds.push({
      table: match[1],
      columns: match[2]
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
    });
  }
  for (const part of select.replace(embedRe, "").split(",")) {
    const column = part.trim();
    if (column) columns.push(column);
  }
  return { columns, embeds };
}

describe("application ↔ database contract", () => {
  it("every rpc() call matches a public function signature exactly", async () => {
    const calls: { file: string; fn: string; args: string[] }[] = [];
    for (const { file, text } of await allSource()) {
      for (const m of text.matchAll(/\.rpc\(\s*"(\w+)"\s*,\s*\{([^}]*)\}/g)) {
        calls.push({ file, fn: m[1], args: [...m[2].matchAll(/(p_\w+)\s*:/g)].map((a) => a[1]).sort() });
      }
    }
    expect(calls.length).toBeGreaterThan(10);

    for (const call of calls) {
      const { rows } = await adminPool().query<{ args: string[] | null }>(
        `select p.proargnames as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [call.fn],
      );
      expect(rows.length, `${call.file}: function public.${call.fn} not found`).toBe(1);
      const inputArgs = (rows[0].args ?? []).filter((a) => a.startsWith("p_")).sort();
      expect(call.args, `${call.file}: arguments of ${call.fn}`).toEqual(inputArgs);
    }
  });

  it("every selected column exists and is readable by authenticated users", async () => {
    const checks: { file: string; table: string; column: string }[] = [];
    for (const { file, text } of await allSource()) {
      for (const m of text.matchAll(/\.from\(\s*"(\w+)"\s*\)\s*\.select\(\s*"([^"]+)"/g)) {
        if (m[1] === "licenses") continue; // storage bucket, not a table
        const { columns, embeds } = parseSelect(m[2]);
        columns.forEach((column) => checks.push({ file, table: m[1], column }));
        embeds.forEach((e) => e.columns.forEach((column) => checks.push({ file, table: e.table, column })));
      }
    }
    expect(checks.length).toBeGreaterThan(20);

    for (const c of checks) {
      const { rows } = await adminPool().query<{ ok: boolean }>(
        "select has_column_privilege('authenticated', $1::regclass, $2, 'SELECT') as ok",
        [`public.${c.table}`, c.column],
      );
      expect(rows[0]?.ok, `${c.file}: public.${c.table}.${c.column}`).toBe(true);
    }
  });
});
