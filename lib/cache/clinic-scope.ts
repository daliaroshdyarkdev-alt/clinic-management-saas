import { isUuid } from "@/modules/tenancy/active-clinic";

/**
 * Builds client-side cache keys that always start with the clinic id
 * (invariant 3, ADR-0002), so data from one clinic can never satisfy a query
 * made in another clinic's workspace.
 */
export function clinicScopedKey(clinicId: string, ...parts: readonly (string | number)[]): readonly string[] {
  if (!isUuid(clinicId)) throw new TypeError("clinicScopedKey requires a clinic UUID");
  return ["clinic", clinicId.toLowerCase(), ...parts.map(String)];
}

/** True when a cache key belongs to the given clinic. Used to purge on switch/sign-out. */
export function belongsToClinic(key: readonly unknown[], clinicId: string): boolean {
  return key[0] === "clinic" && key[1] === clinicId.toLowerCase();
}
