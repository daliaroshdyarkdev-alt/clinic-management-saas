// The service-role client bypasses RLS, so it may be used only by the public
// booking module and the WhatsApp webhook receiver, each calling nothing but
// its own service-role-only SQL functions (docs/adr/0004-public-booking-service-role.md).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CALLERS: Record<string, RegExp> = {
  "modules/public-booking/service.ts": /^public_\w+$/,
  "modules/messaging/webhook-service.ts": /^process_whatsapp_webhook$/,
};
const ALLOWED = new Set(["lib/supabase/service.ts", ...Object.keys(CALLERS)]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("service-role client usage", () => {
  const sources = ["app", "modules", "lib", "components"].flatMap((d) => files(path.join(ROOT, d)));

  it("is referenced only by the allowed services", () => {
    const users = sources
      .filter((f) => /createSupabaseServiceClient|supabase\/service/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(users.sort()).toEqual([...ALLOWED].sort());
  });

  it("calls only its own service-role functions and never reads tables directly", () => {
    for (const [file, allowed] of Object.entries(CALLERS)) {
      const text = readFileSync(path.join(ROOT, file), "utf8");
      const rpcs = [...text.matchAll(/\.rpc\("(\w+)"/g)].map((m) => m[1]);
      expect(rpcs.length, file).toBeGreaterThan(0);
      expect(
        rpcs.every((name) => allowed.test(name)),
        file,
      ).toBe(true);
      expect(text, file).not.toMatch(/\.from\(/);
    }
  });

  it("the secret key is never exposed with a NEXT_PUBLIC_ prefix", () => {
    for (const f of sources) expect(readFileSync(f, "utf8"), f).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SECRET/);
  });
});
