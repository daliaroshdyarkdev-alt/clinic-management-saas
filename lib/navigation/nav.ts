import type { ClinicCapability, ClinicRole } from "@/modules/tenancy/active-clinic";

/**
 * Role-aware navigation. This is presentation only: every page and server
 * function re-checks authorisation, and RLS enforces it in the database.
 * Items whose feature is not built yet are listed with the milestone that
 * delivers them and rendered as disabled, never as working pages.
 */
export type NavKey =
  | "overview"
  | "onboarding"
  | "staff"
  | "doctors"
  | "appointments"
  | "requests"
  | "queue"
  | "myQueue"
  | "patients"
  | "finance"
  | "whatsapp"
  | "subscription";

export type NavItem = {
  key: NavKey;
  href: string;
  /** Roles that always see the item. */
  roles: readonly ClinicRole[];
  /** Also shown to holders of any of these capabilities (owner-granted or implicit). */
  capability?: ClinicCapability | readonly ClinicCapability[];
  /** Also shown to users who are an active doctor of the clinic. */
  doctors?: boolean;
  milestone: number | null;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "overview", href: "/app", roles: ["owner", "manager", "receptionist", "cashier", "doctor"], milestone: null },
  { key: "queue", href: "/app/queue", roles: [], capability: "appointments.manage", milestone: null },
  { key: "myQueue", href: "/app/my-queue", roles: [], doctors: true, milestone: null },
  { key: "appointments", href: "/app/appointments", roles: [], capability: "appointments.manage", milestone: null },
  { key: "requests", href: "/app/requests", roles: [], capability: "appointments.manage", milestone: null },
  { key: "patients", href: "/app/patients", roles: [], capability: "appointments.manage", milestone: null },
  { key: "doctors", href: "/app/doctors", roles: ["owner"], doctors: true, milestone: null },
  { key: "staff", href: "/app/staff", roles: ["owner"], capability: "staff.manage", milestone: null },
  { key: "onboarding", href: "/app/onboarding", roles: ["owner"], milestone: null },
  {
    key: "finance",
    href: "/app/finance",
    roles: ["owner"],
    capability: ["finance.collect", "finance.approve", "finance.reports", "finance.accounts"],
    milestone: null,
  },
  {
    key: "whatsapp",
    href: "/app/whatsapp",
    roles: ["owner"],
    capability: ["appointments.manage", "messaging.send", "messaging.budget"],
    milestone: null,
  },
  { key: "subscription", href: "/app/subscription", roles: ["owner"], milestone: null },
];

export function navItemsFor(
  role: ClinicRole,
  capabilities: readonly ClinicCapability[] = [],
  options: { isDoctor?: boolean } = {},
): NavItem[] {
  return NAV_ITEMS.filter(
    (item) =>
      item.roles.includes(role) ||
      (item.capability !== undefined &&
        (Array.isArray(item.capability) ? item.capability : [item.capability]).some((c) => capabilities.includes(c))) ||
      (item.doctors === true && options.isDoctor === true),
  );
}
