import type { ClinicRole } from "@/lib/tenancy/active-clinic";

/**
 * Role-aware navigation. This is presentation only: every page and server
 * function re-checks authorisation, and RLS enforces it in the database.
 * Items whose feature is not built yet are listed with the milestone that
 * delivers them and rendered as disabled, never as working pages.
 */
export type NavItem = {
  key: "overview" | "appointments" | "myQueue" | "patients" | "finance" | "whatsapp" | "staff" | "subscription";
  href: string;
  roles: readonly ClinicRole[];
  milestone: number | null;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "overview", href: "/app", roles: ["owner", "manager", "receptionist", "cashier", "doctor"], milestone: null },
  { key: "appointments", href: "/app/appointments", roles: ["owner", "manager", "receptionist"], milestone: 2 },
  { key: "myQueue", href: "/app/my-queue", roles: ["doctor"], milestone: 2 },
  { key: "patients", href: "/app/patients", roles: ["owner", "manager", "receptionist"], milestone: 3 },
  { key: "finance", href: "/app/finance", roles: ["owner", "cashier"], milestone: 4 },
  { key: "whatsapp", href: "/app/whatsapp", roles: ["owner"], milestone: 5 },
  { key: "staff", href: "/app/staff", roles: ["owner"], milestone: 1 },
  { key: "subscription", href: "/app/subscription", roles: ["owner"], milestone: 6 },
];

export function navItemsFor(role: ClinicRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
