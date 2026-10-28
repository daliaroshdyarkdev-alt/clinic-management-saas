import { describe, expect, it } from "vitest";
import { cairoDateKey, cairoOffsetMinutes, formatClinicDateTime } from "@/lib/time/cairo";
import { directionOf } from "@/i18n/routing";

describe("Africa/Cairo time", () => {
  it("is UTC+2 in winter", () => {
    expect(cairoOffsetMinutes(new Date("2026-01-15T10:00:00Z"))).toBe(120);
  });

  it("is UTC+3 during Egyptian daylight saving time", () => {
    expect(cairoOffsetMinutes(new Date("2026-07-15T10:00:00Z"))).toBe(180);
  });

  it("assigns late-evening UTC instants to the next Cairo calendar day", () => {
    expect(cairoDateKey(new Date("2026-01-15T22:30:00Z"))).toBe("2026-01-16");
  });

  it("formats in Arabic with Egyptian locale data", () => {
    expect(formatClinicDateTime(new Date("2026-01-15T10:00:00Z"), "ar")).toMatch(/[؀-ۿ]/);
  });
});

describe("text direction", () => {
  it("Arabic is RTL, English is LTR", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("en")).toBe("ltr");
  });
});
