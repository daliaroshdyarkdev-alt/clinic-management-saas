import { describe, expect, it } from "vitest";

import { clinicCanOperate, isUuid, resolveActiveClinic, switchableClinics } from "./active-clinic";
import type { ClinicMembership } from "./types";

const clinicA = "11111111-1111-4111-8111-111111111111";
const clinicB = "22222222-2222-4222-8222-222222222222";
const clinicC = "33333333-3333-4333-8333-333333333333";

const memberships: ClinicMembership[] = [
  { clinicId: clinicA, clinicName: "A", clinicState: "active", status: "active", roles: ["receptionist"], grants: [] },
  { clinicId: clinicB, clinicName: "B", clinicState: "active", status: "suspended", roles: ["doctor"], grants: [] },
];

describe("resolveActiveClinic (invariant 2)", () => {
  it("resolves an active membership of the requested clinic", () => {
    expect(resolveActiveClinic(memberships, clinicA)?.clinicId).toBe(clinicA);
  });

  it("is case-insensitive for UUIDs", () => {
    expect(resolveActiveClinic(memberships, clinicA.toUpperCase())?.clinicId).toBe(clinicA);
  });

  it("denies a clinic the user has no membership in (forged/guessed id)", () => {
    expect(resolveActiveClinic(memberships, clinicC)).toBeNull();
  });

  it("denies a suspended membership (STA-003)", () => {
    expect(resolveActiveClinic(memberships, clinicB)).toBeNull();
  });

  it.each([undefined, null, "", "not-a-uuid", `${clinicA} `, "../admin", 42])("rejects malformed id %p", (value) => {
    expect(resolveActiveClinic(memberships, value)).toBeNull();
  });

  it("denies everything when the user has no memberships", () => {
    expect(resolveActiveClinic([], clinicA)).toBeNull();
  });
});

describe("switchableClinics (STA-004)", () => {
  it("lists only active memberships", () => {
    expect(switchableClinics(memberships).map((m) => m.clinicId)).toEqual([clinicA]);
  });
});

describe("clinicCanOperate (ONB-004)", () => {
  it("allows operations only for active clinics", () => {
    expect(clinicCanOperate({ clinicState: "active" })).toBe(true);
    expect(clinicCanOperate({ clinicState: "pending_verification" })).toBe(false);
    expect(clinicCanOperate({ clinicState: "suspended" })).toBe(false);
  });
});

describe("isUuid", () => {
  it("accepts RFC 4122 UUIDs only", () => {
    expect(isUuid(clinicA)).toBe(true);
    expect(isUuid("11111111-1111-1111-1111-11111111111")).toBe(false);
  });
});
