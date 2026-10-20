import { describe, expect, it } from "vitest";

import { effectiveCapabilities } from "./capabilities";
import { adminSections, buildClinicNavigation } from "./navigation";

describe("buildClinicNavigation", () => {
  it("shows a receptionist appointments, queue and patients but no finance or consultations", () => {
    const nav = buildClinicNavigation(effectiveCapabilities(["receptionist"]), "active");
    expect(nav).toEqual(["overview", "appointments", "queue", "patients"]);
  });

  it("shows a doctor consultations but not finance, staff or settings", () => {
    const nav = buildClinicNavigation(effectiveCapabilities(["doctor"]), "active");
    expect(nav).toContain("consultations");
    expect(nav).not.toContain("finance");
    expect(nav).not.toContain("staff");
    expect(nav).not.toContain("settings");
  });

  it("never shows consultations to an owner without the doctor role", () => {
    expect(buildClinicNavigation(effectiveCapabilities(["owner"]), "active")).not.toContain("consultations");
  });

  it("shows a cashier only overview and their shift", () => {
    expect(buildClinicNavigation(effectiveCapabilities(["cashier"]), "active")).toEqual(["overview", "cashier"]);
  });

  it.each(["pending_verification", "documents_requested", "rejected", "suspended", "closed"] as const)(
    "hides operational sections while the clinic is %s (ONB-004)",
    (state) => {
      const nav = buildClinicNavigation(effectiveCapabilities(["owner"]), state);
      expect(nav).toEqual(["overview", "settings"]);
    },
  );
});

describe("admin navigation (ADM-003, ADM-004)", () => {
  it("has no clinic medical, finance or impersonation entries", () => {
    expect(adminSections.join(" ")).not.toMatch(/medical|consult|finance|cashier|impersonat|support/);
  });
});
