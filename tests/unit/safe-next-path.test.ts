import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/safe-next-path";

describe("safeNextPath", () => {
  it("accepts paths inside the app area, with or without locale prefix", () => {
    expect(safeNextPath("/ar/app/appointments", "ar")).toBe("/app/appointments");
    expect(safeNextPath("/app", "en")).toBe("/app");
  });

  it.each([
    "https://evil.example/app",
    "//evil.example/app",
    "/app/../login",
    "/app//evil.example",
    "/en/admin",
    "/app?x=https://evil.example",
    "javascript:alert(1)",
    "/invite/short",
    "/invite/abc/../../x",
  ])("rejects %s", (next) => {
    expect(safeNextPath(next, "ar")).toBe("/app");
  });

  it("accepts the admin area and invitation links", () => {
    expect(safeNextPath("/en/admin/clinics", "en")).toBe("/admin/clinics");
    expect(safeNextPath("/ar/invite/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde", "ar")).toBe(
      "/invite/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde",
    );
  });

  it("falls back when nothing is given", () => {
    expect(safeNextPath(undefined, "ar")).toBe("/app");
  });
});
