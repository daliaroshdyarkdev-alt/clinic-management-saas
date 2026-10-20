/**
 * Clinic capability model (STA-001, STA-005, FIN-010, WAP-013/014, MED-005).
 *
 * This module is the single source of truth for which capability a role can
 * ever hold. It is used for navigation in Milestone 0 and, from Milestone 1,
 * mirrored by a database trigger on `permission_grants`. UI visibility is only
 * a hint. Every server action and RLS policy must check again.
 *
 * Default sets are PROPOSED (OPEN_DECISIONS OD-21). Locked rules are CONFIRMED
 * requirements and cannot be changed by an owner.
 */

export const clinicRoles = ["owner", "manager", "receptionist", "cashier", "doctor"] as const;
export type ClinicRole = (typeof clinicRoles)[number];

export const capabilities = [
  "clinic.overview.view",
  "clinic.settings.manage",
  "staff.manage", // invite / suspend / deactivate (STA-005: owner, or manager if granted)
  "staff.roles.assign", // role and permission changes (owner only, locked)
  "appointments.manage", // all doctors in the clinic (APT-015)
  "appointments.own", // doctor's own schedule and queue
  "queue.manage",
  "patients.demographics",
  "patients.assigned",
  "medical.assigned_visits", // protected clinical content (doctor only, locked)
  "finance.view",
  "finance.cashier",
  "reports.view",
  "whatsapp.operate",
  "whatsapp.budget.manage", // owner, or manager with explicit grant (WAP-013)
  "subscription.manage",
] as const;
export type Capability = (typeof capabilities)[number];

type RolePolicy = {
  /** Held by every member with this role (PROPOSED defaults, OD-21). */
  base: readonly Capability[];
  /** May be added by the clinic owner. Anything not listed here is never grantable. */
  grantable: readonly Capability[];
};

export const rolePolicies: Readonly<Record<ClinicRole, RolePolicy>> = {
  owner: {
    base: [
      "clinic.overview.view",
      "clinic.settings.manage",
      "staff.manage",
      "staff.roles.assign",
      "appointments.manage",
      "queue.manage",
      "patients.demographics",
      "finance.view",
      "reports.view",
      "whatsapp.operate",
      "whatsapp.budget.manage",
      "subscription.manage",
    ],
    grantable: [],
  },
  manager: {
    base: ["clinic.overview.view"],
    grantable: [
      "clinic.settings.manage",
      "staff.manage",
      "appointments.manage",
      "queue.manage",
      "patients.demographics",
      "finance.view",
      "reports.view",
      "whatsapp.operate",
      "whatsapp.budget.manage",
      "subscription.manage",
    ],
  },
  receptionist: {
    base: ["clinic.overview.view", "appointments.manage", "queue.manage", "patients.demographics"],
    grantable: ["whatsapp.operate"],
  },
  cashier: {
    base: ["clinic.overview.view", "finance.cashier"],
    grantable: ["finance.view", "reports.view", "patients.demographics"],
  },
  doctor: {
    base: ["clinic.overview.view", "appointments.own", "patients.assigned", "medical.assigned_visits"],
    grantable: [],
  },
};

/**
 * Locked boundaries (CONFIRMED). Each capability may only come from the base
 * set of the listed role and can never be granted to anyone.
 */
export const lockedCapabilities: Readonly<Partial<Record<Capability, ClinicRole>>> = {
  "medical.assigned_visits": "doctor", // invariant 4, MED-005, STA-006, OD-04
  "staff.roles.assign": "owner", // STA-005
};

export function isLockedCapability(capability: Capability): boolean {
  return capability in lockedCapabilities;
}

/** Whether an owner may grant `capability` to a member holding `roles`. */
export function isGrantable(capability: Capability, roles: readonly ClinicRole[]): boolean {
  if (isLockedCapability(capability)) return false;
  return roles.some((role) => rolePolicies[role].grantable.includes(capability));
}

/**
 * Effective capabilities = base capabilities of every held role plus explicit
 * grants that are allowed for those roles. Unknown or non-grantable grants are
 * dropped, never trusted.
 */
export function effectiveCapabilities(
  roles: readonly ClinicRole[],
  grants: readonly string[] = [],
): ReadonlySet<Capability> {
  const result = new Set<Capability>();
  for (const role of roles) {
    for (const capability of rolePolicies[role].base) result.add(capability);
  }
  for (const grant of grants) {
    if (isCapability(grant) && isGrantable(grant, roles)) result.add(grant);
  }
  return result;
}

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && (capabilities as readonly string[]).includes(value);
}

export function isClinicRole(value: unknown): value is ClinicRole {
  return typeof value === "string" && (clinicRoles as readonly string[]).includes(value);
}

/** STA-005: only an owner assigns roles and changes permissions. */
export function canAssignRoles(actorRoles: readonly ClinicRole[]): boolean {
  return actorRoles.includes("owner");
}

/**
 * STA-005: an owner membership is protected from subordinate revocation and
 * from self-lockout, so staff-management flows can never change it.
 */
export function canChangeMembershipStatus(
  actorCapabilities: ReadonlySet<Capability>,
  targetRoles: readonly ClinicRole[],
): boolean {
  if (targetRoles.includes("owner")) return false;
  return actorCapabilities.has("staff.manage");
}
