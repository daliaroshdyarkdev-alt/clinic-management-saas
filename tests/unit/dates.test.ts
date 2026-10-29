import { describe, expect, it } from "vitest";
import { addDays, cairoToday, isDateKey } from "@/lib/time/dates";

describe("date keys", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });

  it("today is the Cairo calendar day", () => {
    expect(cairoToday(new Date("2026-10-28T22:30:00Z"))).toBe("2026-10-29");
  });

  it("validates date keys", () => {
    expect(isDateKey("2026-10-29")).toBe(true);
    expect(isDateKey("2026-13-40")).toBe(false);
    expect(isDateKey("tomorrow")).toBe(false);
  });
});
