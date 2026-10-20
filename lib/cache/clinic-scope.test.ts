import { describe, expect, it } from "vitest";

import { belongsToClinic, clinicScopedKey } from "./clinic-scope";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("clinicScopedKey (invariant 3)", () => {
  it("prefixes every key with the clinic id", () => {
    expect(clinicScopedKey(A, "appointments", 2)).toEqual(["clinic", A, "appointments", "2"]);
  });

  it("keys for different clinics never collide", () => {
    expect(clinicScopedKey(A, "patients")).not.toEqual(clinicScopedKey(B, "patients"));
    expect(belongsToClinic(clinicScopedKey(A, "patients"), B)).toBe(false);
    expect(belongsToClinic(clinicScopedKey(A, "patients"), A.toUpperCase())).toBe(true);
  });

  it("requires a valid clinic UUID", () => {
    expect(() => clinicScopedKey("", "x")).toThrow(TypeError);
  });
});
