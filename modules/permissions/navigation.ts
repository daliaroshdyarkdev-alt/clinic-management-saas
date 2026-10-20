import type { Capability } from "./capabilities";
import type { ClinicAccountState } from "@/modules/tenancy/types";

export const clinicSections = [
  "overview",
  "appointments",
  "queue",
  "patients",
  "consultations",
  "finance",
  "cashier",
  "reports",
  "whatsapp",
  "staff",
  "subscription",
  "settings",
] as const;
export type ClinicSection = (typeof clinicSections)[number];

type SectionDefinition = {
  /** Visible when the member holds ANY of these. Empty = every active member. */
  anyOf: readonly Capability[];
  milestone: number;
  requirements: readonly string[];
  /** ONB-004: before activation only onboarding-related sections are reachable. */
  beforeActivation: boolean;
};

export const clinicSectionDefinitions: Readonly<Record<ClinicSection, SectionDefinition>> = {
  overview: { anyOf: [], milestone: 0, requirements: ["STA-004", "ONB-004"], beforeActivation: true },
  appointments: {
    anyOf: ["appointments.manage", "appointments.own"],
    milestone: 2,
    requirements: ["APT-001", "APT-002", "APT-003", "APT-012", "APT-013", "APT-015"],
    beforeActivation: false,
  },
  queue: {
    anyOf: ["queue.manage", "appointments.own"],
    milestone: 2,
    requirements: ["APT-006", "APT-007", "APT-008", "APT-009", "APT-010", "APT-014"],
    beforeActivation: false,
  },
  patients: {
    anyOf: ["patients.demographics", "patients.assigned"],
    milestone: 3,
    requirements: ["PAT-001", "PAT-002", "PAT-003", "PAT-005"],
    beforeActivation: false,
  },
  consultations: {
    anyOf: ["medical.assigned_visits"],
    milestone: 3,
    requirements: ["MED-001", "MED-003", "MED-004", "MED-005", "MED-006"],
    beforeActivation: false,
  },
  finance: {
    anyOf: ["finance.view"],
    milestone: 4,
    requirements: ["FIN-001", "FIN-002", "FIN-003", "FIN-006", "FIN-007", "FIN-008", "FIN-009"],
    beforeActivation: false,
  },
  cashier: {
    anyOf: ["finance.cashier"],
    milestone: 4,
    requirements: ["FIN-004", "FIN-005", "FIN-012"],
    beforeActivation: false,
  },
  reports: { anyOf: ["reports.view"], milestone: 4, requirements: ["FIN-013"], beforeActivation: false },
  whatsapp: {
    anyOf: ["whatsapp.operate", "whatsapp.budget.manage"],
    milestone: 5,
    requirements: ["WAP-002", "WAP-007", "WAP-012", "WAP-013"],
    beforeActivation: false,
  },
  staff: {
    anyOf: ["staff.manage", "staff.roles.assign"],
    milestone: 1,
    requirements: ["STA-001", "STA-002", "STA-003", "STA-005"],
    beforeActivation: false,
  },
  subscription: {
    anyOf: ["subscription.manage"],
    milestone: 6,
    requirements: ["SUB-001", "SUB-006", "SUB-008", "SUB-009"],
    beforeActivation: false,
  },
  settings: {
    anyOf: ["clinic.settings.manage"],
    milestone: 1,
    requirements: ["ONB-002", "ONB-006"],
    beforeActivation: true,
  },
};

/**
 * Navigation entries for a member. Display only (ADR-0002); never use this
 * result to authorize a request.
 */
export function buildClinicNavigation(
  capabilitySet: ReadonlySet<Capability>,
  clinicState: ClinicAccountState,
): ClinicSection[] {
  const active = clinicState === "active";
  return clinicSections.filter((section) => {
    const definition = clinicSectionDefinitions[section];
    if (!active && !definition.beforeActivation) return false;
    return definition.anyOf.length === 0 || definition.anyOf.some((c) => capabilitySet.has(c));
  });
}

/** Platform administration (ADM-001/002). No clinic medical/finance entries (ADM-003) and no support impersonation (ADM-004, Q97). */
export const adminSections = ["overview", "verifications", "clinics", "subscriptions", "plans", "audit"] as const;
export type AdminSection = (typeof adminSections)[number];

export const adminSectionDefinitions: Readonly<
  Record<AdminSection, { milestone: number; requirements: readonly string[] }>
> = {
  overview: { milestone: 0, requirements: ["ADM-001", "ADM-003"] },
  verifications: { milestone: 1, requirements: ["ONB-003", "ADM-001"] },
  clinics: { milestone: 1, requirements: ["ONB-005", "ADM-001"] },
  subscriptions: { milestone: 6, requirements: ["ADM-002", "SUB-003", "SUB-006"] },
  plans: { milestone: 6, requirements: ["SUB-010"] },
  audit: { milestone: 1, requirements: ["STA-007"] },
};
