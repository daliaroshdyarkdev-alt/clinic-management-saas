import { describe, expect, it } from "vitest";

import { isProtectedPath } from "./protected-paths";
import { safeNextPath } from "./redirect";

describe("safeNextPath (open-redirect protection)", () => {
  it("accepts locale-prefixed app paths", () => {
    expect(safeNextPath("/ar/c/abc/queue?x=1", "ar")).toBe("/ar/c/abc/queue?x=1");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/fr/anything",
    "javascript:alert(1)",
    "/ar/\u0000x",
    undefined,
    ["/ar/x"],
  ])("falls back for %p", (candidate) => {
    expect(safeNextPath(candidate, "en")).toBe("/en/workspaces");
  });
});

describe("isProtectedPath", () => {
  it("protects workspaces, clinic and admin areas", () => {
    expect(isProtectedPath("/ar/workspaces")).toBe(true);
    expect(isProtectedPath("/en/c/abc")).toBe(true);
    expect(isProtectedPath("/en/admin/clinics")).toBe(true);
  });

  it("leaves public pages open", () => {
    expect(isProtectedPath("/ar")).toBe(false);
    expect(isProtectedPath("/ar/login")).toBe(false);
    expect(isProtectedPath("/en/preview/admin")).toBe(false);
  });
});
