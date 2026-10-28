export const ACTIVE_CLINIC_COOKIE = "active_clinic_id";

export type ClinicRole = "owner" | "manager" | "receptionist" | "cashier" | "doctor";
export type ClinicAccountState = "pending" | "active" | "suspended" | "closed";

export type WorkspaceClinic = {
  clinicId: string;
  name: string;
  accountState: ClinicAccountState;
  role: ClinicRole;
};

/**
 * Picks the clinic to display. The cookie is only a *view hint* (SRS §2.1
 * invariant 2): it is honoured only when it names a clinic in `clinics`, which
 * must come from an RLS-filtered query of the caller's active memberships.
 * A forged or stale cookie silently falls back to the first authorised clinic.
 */
export function resolveActiveClinic(
  clinics: readonly WorkspaceClinic[],
  requestedClinicId: string | undefined,
): WorkspaceClinic | null {
  if (clinics.length === 0) return null;
  const requested = requestedClinicId ? clinics.find((c) => c.clinicId === requestedClinicId) : undefined;
  if (requested) return requested;
  return [...clinics].sort((a, b) => a.name.localeCompare(b.name) || a.clinicId.localeCompare(b.clinicId))[0];
}
