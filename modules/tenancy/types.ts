import type { ClinicRole } from "@/modules/permissions/capabilities";

/** Proposed lifecycle (ONB-003, ONB-005; OPEN_DECISIONS OD-06). */
export const clinicAccountStates = [
  "pending_verification",
  "documents_requested",
  "rejected",
  "active",
  "suspended",
  "closed",
] as const;
export type ClinicAccountState = (typeof clinicAccountStates)[number];

/** STA-003: temporary `suspended` vs permanent `deactivated`. */
export const membershipStatuses = ["invited", "active", "suspended", "deactivated"] as const;
export type MembershipStatus = (typeof membershipStatuses)[number];

/** Membership as loaded on the server for the authenticated user. */
export type ClinicMembership = {
  clinicId: string;
  clinicName: string;
  clinicState: ClinicAccountState;
  status: MembershipStatus;
  roles: readonly ClinicRole[];
  /** Raw grants from storage; filtered by `effectiveCapabilities`. */
  grants: readonly string[];
};
