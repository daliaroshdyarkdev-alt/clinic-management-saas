import { describe, expect, it } from "vitest";

import * as fixtures from "./fixtures";

describe("preview fixtures are synthetic (CLAUDE.md: no real patient data)", () => {
  const serialized = JSON.stringify(fixtures);

  it("contain no phone numbers, emails or national-ID-like digit runs", () => {
    expect(serialized).not.toMatch(/\d{9,}/);
    expect(serialized).not.toMatch(/[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i);
  });

  it("identify patients by generated codes only", () => {
    for (const appointment of fixtures.demoAppointments) expect(appointment.patientCode).toMatch(/^PT-\d{4}$/);
  });

  it("label every clinic and doctor as demo/test", () => {
    for (const clinic of fixtures.demoClinics) {
      expect(clinic.name.en).toMatch(/demo/i);
    }
  });
});
