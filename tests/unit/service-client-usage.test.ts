// The service-role client bypasses RLS, so it may be used only by the public
// booking module, which calls nothing but the service-role-only `public_*`
// SQL functions (docs/adr/0004-public-booking-service-role.md).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ALLOWED = new Set(["lib/supabase/service.ts", "modules/public-booking/service.ts"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("service-role client usage", () => {
  const sources = ["app", "modules", "lib", "components"].flatMap((d) => files(path.join(ROOT, d)));

  it("is referenced only by the public booking service", () => {
    const users = sources
      .filter((f) => /createSupabaseServiceClient|supabase\/service/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(users.sort()).toEqual([...ALLOWED].sort());
  });

  it("calls only public_* functions and never reads tables directly", () => {
    const text = readFileSync(path.join(ROOT, "modules/public-booking/service.ts"), "utf8");
    const rpcs = [...text.matchAll(/\.rpc\("(\w+)"/g)].map((m) => m[1]);
    expect(rpcs.length).toBeGreaterThan(0);
    expect(rpcs.every((name) => name.startsWith("public_"))).toBe(true);
    expect(text).not.toMatch(/\.from\(/);
  });

  it("the secret key is never exposed with a NEXT_PUBLIC_ prefix", () => {
    for (const f of sources) expect(readFileSync(f, "utf8"), f).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SECRET/);
  });
});
