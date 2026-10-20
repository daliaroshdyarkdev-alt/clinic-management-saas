import { describe, expect, it } from "vitest";

import {
  canAssignRoles,
  canChangeMembershipStatus,
  capabilities,
  clinicRoles,
  effectiveCapabilities,
  isGrantable,
  lockedCapabilities,
  rolePolicies,
  type ClinicRole,
} from "./capabilities";

const nonDoctorRoles = clinicRoles.filter((role) => role !== "doctor");

describe("medical-content boundary (invariant 4, MED-005, STA-006)", () => {
  it.each(nonDoctorRoles)("%s never holds medical capabilities by default", (role) => {
    expect(effectiveCapabilities([role]).has("medical.assigned_visits")).toBe(false);
  });

  it.each(nonDoctorRoles)("%s cannot be granted medical capabilities by an owner", (role) => {
    expect(isGrantable("medical.assigned_visits", [role])).toBe(false);
    expect(effectiveCapabilities([role], ["medical.assigned_visits"]).has("medical.assigned_visits")).toBe(false);
  });

  it("owner + doctor gets medical access only through the doctor role", () => {
    expect(effectiveCapabilities(["owner"]).has("medical.assigned_visits")).toBe(false);
    expect(effectiveCapabilities(["owner", "doctor"]).has("medical.assigned_visits")).toBe(true);
  });

  it("no role lists a locked capability as grantable", () => {
    for (const role of clinicRoles) {
      for (const locked of Object.keys(lockedCapabilities)) {
        expect(rolePolicies[role].grantable).not.toContain(locked);
      }
    }
  });

  it("locked capabilities appear only in the base set of their owning role", () => {
    for (const [capability, owner] of Object.entries(lockedCapabilities)) {
      for (const role of clinicRoles) {
        const inBase = (rolePolicies[role].base as readonly string[]).includes(capability);
        expect(inBase).toBe(role === owner);
      }
    }
  });
});

describe("role and permission administration (STA-005)", () => {
  it("only an owner can assign roles", () => {
    expect(canAssignRoles(["owner"])).toBe(true);
    for (const role of nonDoctorRoles.filter((r) => r !== "owner")) expect(canAssignRoles([role])).toBe(false);
    expect(canAssignRoles(["doctor"])).toBe(false);
  });

  it("a manager can never be granted role assignment", () => {
    expect(isGrantable("staff.roles.assign", ["manager"])).toBe(false);
    expect(effectiveCapabilities(["manager"], ["staff.roles.assign"]).has("staff.roles.assign")).toBe(false);
  });

  it("a manager can be granted staff invite/suspend", () => {
    expect(effectiveCapabilities(["manager"], ["staff.manage"]).has("staff.manage")).toBe(true);
  });

  it("protects owner memberships from subordinate revocation and self-lockout", () => {
    const managerWithStaff = effectiveCapabilities(["manager"], ["staff.manage"]);
    const owner = effectiveCapabilities(["owner"]);
    expect(canChangeMembershipStatus(managerWithStaff, ["owner"])).toBe(false);
    expect(canChangeMembershipStatus(owner, ["owner"])).toBe(false);
    expect(canChangeMembershipStatus(managerWithStaff, ["receptionist"])).toBe(true);
    expect(canChangeMembershipStatus(effectiveCapabilities(["receptionist"]), ["cashier"])).toBe(false);
  });
});

describe("finance and messaging boundaries", () => {
  it("finance is not visible to receptionists or doctors by default (FIN-010)", () => {
    for (const role of ["receptionist", "doctor"] as ClinicRole[]) {
      expect(effectiveCapabilities([role]).has("finance.view")).toBe(false);
    }
  });

  it("WhatsApp spend ceiling needs an explicit grant for managers (WAP-013)", () => {
    expect(effectiveCapabilities(["manager"]).has("whatsapp.budget.manage")).toBe(false);
    expect(effectiveCapabilities(["manager"], ["whatsapp.budget.manage"]).has("whatsapp.budget.manage")).toBe(true);
    expect(effectiveCapabilities(["receptionist"], ["whatsapp.budget.manage"]).has("whatsapp.budget.manage")).toBe(
      false,
    );
  });

  it("drops unknown or forged grants", () => {
    const result = effectiveCapabilities(
      ["receptionist"],
      ["platform.support.impersonate", "finance.view", "__proto__"],
    );
    expect([...result].every((c) => (capabilities as readonly string[]).includes(c))).toBe(true);
    expect(result.has("finance.view")).toBe(false);
  });

  it("defines no support-impersonation capability (ADM-004, Q97)", () => {
    expect(capabilities.some((c) => /impersonat|support/i.test(c))).toBe(false);
  });
});
