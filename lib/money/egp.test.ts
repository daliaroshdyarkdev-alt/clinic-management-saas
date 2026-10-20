import { describe, expect, it } from "vitest";

import { addPiasters, formatEgp, piasters } from "./egp";

describe("piasters (FIN-015)", () => {
  it("accepts safe integers only", () => {
    expect(piasters(12_345)).toBe(12_345);
    expect(() => piasters(10.5)).toThrow(TypeError);
    expect(() => piasters(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
    expect(() => piasters(Number.NaN)).toThrow(TypeError);
  });

  it("adds without floating-point drift", () => {
    expect(addPiasters(piasters(10), piasters(20))).toBe(30);
  });

  it("formats EGP in both locales", () => {
    expect(formatEgp(piasters(1_250_000), "en")).toMatch(/12,500/);
    expect(formatEgp(piasters(1_050), "en")).toMatch(/10\.50/);
    expect(formatEgp(piasters(1_250_000), "ar")).toMatch(/١٢٬?٥٠٠/);
  });
});
