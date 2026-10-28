import { describe, expect, it } from "vitest";
import { resolveActiveClinic, type WorkspaceClinic } from "@/modules/tenancy/active-clinic";

const a: WorkspaceClinic = {
  clinicId: "00000000-0000-4000-8000-00000000000a",
  name: "Beta Clinic",
  accountState: "active",
  role: "doctor",
};
const b: WorkspaceClinic = {
  clinicId: "00000000-0000-4000-8000-00000000000b",
  name: "Alpha Clinic",
  accountState: "pending",
  role: "owner",
};

describe("resolveActiveClinic", () => {
  it("returns null when the user has no authorised clinic", () => {
    expect(resolveActiveClinic([], a.clinicId)).toBeNull();
  });

  it("honours the cookie when it names an authorised clinic", () => {
    expect(resolveActiveClinic([a, b], a.clinicId)).toBe(a);
  });

  it("ignores a forged cookie for a clinic outside the authorised list", () => {
    const forged = "00000000-0000-4000-8000-0000000000ff";
    expect(resolveActiveClinic([a], forged)).toBe(a);
  });

  it("falls back deterministically (by name) when no cookie is set", () => {
    expect(resolveActiveClinic([a, b], undefined)).toBe(b);
  });
});
