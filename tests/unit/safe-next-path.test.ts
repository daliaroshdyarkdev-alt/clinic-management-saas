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
  ])("rejects %s", (next) => {
    expect(safeNextPath(next, "ar")).toBe("/app");
  });

  it("falls back when nothing is given", () => {
    expect(safeNextPath(undefined, "ar")).toBe("/app");
  });
});
