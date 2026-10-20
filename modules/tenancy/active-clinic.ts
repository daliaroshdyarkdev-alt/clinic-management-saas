import type { ClinicMembership } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Resolves the clinic a request may act in (invariant 2, ADR-0002).
 *
 * `requestedClinicId` comes from the URL and is only a view hint. The result is
 * non-null only when the authenticated user's own, server-loaded memberships
 * contain an ACTIVE membership for that clinic. Callers must answer `null` with
 * a 404 so clinic existence is not disclosed.
 */
export function resolveActiveClinic(
  memberships: readonly ClinicMembership[],
  requestedClinicId: unknown,
): ClinicMembership | null {
  if (!isUuid(requestedClinicId)) return null;
  const id = requestedClinicId.toLowerCase();
  return (
    memberships.find((membership) => membership.clinicId.toLowerCase() === id && membership.status === "active") ?? null
  );
}

/** Memberships that may appear in the clinic switcher (STA-004). */
export function switchableClinics(memberships: readonly ClinicMembership[]): ClinicMembership[] {
  return memberships.filter((membership) => membership.status === "active");
}

/** ONB-004: live operations (appointments, consultations, messages) need an active clinic. */
export function clinicCanOperate(membership: Pick<ClinicMembership, "clinicState">): boolean {
  return membership.clinicState === "active";
}
