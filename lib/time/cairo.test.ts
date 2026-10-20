import { describe, expect, it } from "vitest";

import { clinicDateKey, formatClinicTime } from "./cairo";

describe("Cairo clinic time (SRS §6)", () => {
  it("converts UTC to Cairo wall-clock time during summer time (UTC+3)", () => {
    expect(formatClinicTime("2026-07-01T06:00:00Z", "en")).toMatch(/9:00/);
  });

  it("converts UTC to Cairo wall-clock time in winter (UTC+2)", () => {
    expect(formatClinicTime("2026-12-01T06:00:00Z", "en")).toMatch(/8:00/);
  });

  it("assigns late-UTC instants to the next Cairo calendar day", () => {
    expect(clinicDateKey("2026-12-01T22:30:00Z")).toBe("2026-12-02");
    expect(clinicDateKey("2026-12-01T21:30:00Z")).toBe("2026-12-01");
  });

  it("rejects invalid timestamps", () => {
    expect(() => formatClinicTime("not-a-date", "en")).toThrow(RangeError);
  });
});
