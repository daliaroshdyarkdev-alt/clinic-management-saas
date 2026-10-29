import { describe, expect, it } from "vitest";
import { formatEgp, parseEgpToMinor } from "@/lib/money";

describe("money", () => {
  it("parses EGP into piasters without floating point", () => {
    expect(parseEgpToMinor("150")).toBe(15000);
    expect(parseEgpToMinor("150.5")).toBe(15050);
    expect(parseEgpToMinor("0.07")).toBe(7);
    expect(parseEgpToMinor("1,250.99")).toBe(125099);
    expect(parseEgpToMinor("١٥٠٫٧٥")).toBe(15075);
  });

  it("rejects invalid amounts", () => {
    for (const bad of ["", "-5", "1.234", "abc", "1e3", "12.3.4"]) expect(parseEgpToMinor(bad), bad).toBeNull();
  });

  it("formats with two decimals", () => {
    expect(formatEgp(15050, "en")).toMatch(/150\.50/);
    expect(formatEgp(15050, "ar")).toMatch(/[٠-٩]/);
  });
});
