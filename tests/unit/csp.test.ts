import { describe, expect, it } from "vitest";
import { buildCsp, createNonce } from "@/lib/security/csp";

describe("content security policy", () => {
  it("allows only nonce'd scripts in production and blocks framing", () => {
    const csp = buildCsp("abc", { dev: false, supabaseUrl: "https://xyz.supabase.co" });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self' https://xyz.supabase.co wss://xyz.supabase.co");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("nonces are random and base64", () => {
    const a = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(a);
  });
});
