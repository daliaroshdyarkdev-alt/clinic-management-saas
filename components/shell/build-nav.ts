import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Capability } from "@/modules/permissions/capabilities";
import {
  adminSectionDefinitions,
  adminSections,
  buildClinicNavigation,
  clinicSectionDefinitions,
  type AdminSection,
  type ClinicSection,
} from "@/modules/permissions/navigation";
import type { ClinicAccountState } from "@/modules/tenancy/types";

import type { NavItem } from "./types";

/** `basePath` is the clinic workspace root, e.g. `/ar/c/<clinicId>`. */
export function clinicNavItems(
  dict: Dictionary,
  capabilitySet: ReadonlySet<Capability>,
  clinicState: ClinicAccountState,
  basePath: string,
  activeSection: ClinicSection,
): NavItem[] {
  return buildClinicNavigation(capabilitySet, clinicState).map((section) => ({
    key: section,
    label: dict.nav[section],
    href: section === "overview" ? basePath : `${basePath}/${section}`,
    active: section === activeSection,
    plannedMilestone: clinicSectionDefinitions[section].milestone || undefined,
  }));
}

export function adminNavItems(dict: Dictionary, basePath: string, activeSection: AdminSection): NavItem[] {
  return adminSections.map((section) => ({
    key: section,
    label: dict.adminNav[section],
    href: section === "overview" ? basePath : `${basePath}/${section}`,
    active: section === activeSection,
    plannedMilestone: adminSectionDefinitions[section].milestone || undefined,
  }));
}
