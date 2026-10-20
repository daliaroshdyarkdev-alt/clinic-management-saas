import "server-only";

import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AdminDashboardPreview } from "@/components/dashboard/admin-dashboard-preview";
import { ClinicDashboardPreview } from "@/components/dashboard/clinic-dashboard-preview";
import { adminNavItems, clinicNavItems } from "@/components/shell/build-nav";
import { AppShell } from "@/components/shell/app-shell";
import { ClinicSwitcher } from "@/components/shell/clinic-switcher";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { PreviewBanner } from "@/components/shell/preview-banner";
import { RoleSwitcher } from "@/components/shell/role-switcher";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";
import { UserMenu } from "@/components/shell/user-menu";
import { Badge } from "@/components/ui/badge";
import { demoClinics, demoMemberships, demoRoles, findDemoClinic } from "@/lib/demo/fixtures";
import { isUiPreviewEnabled } from "@/lib/env/server";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { effectiveCapabilities, isClinicRole } from "@/modules/permissions/capabilities";
import {
  adminSectionDefinitions,
  adminSections,
  buildClinicNavigation,
  clinicSectionDefinitions,
  type AdminSection,
  type ClinicSection,
} from "@/modules/permissions/navigation";
import { resolveActiveClinic } from "@/modules/tenancy/active-clinic";

/** ADR-0005: preview routes exist only when explicitly enabled outside production. */
export function assertPreview(lang: string): Locale {
  if (!isUiPreviewEnabled() || !isLocale(lang)) notFound();
  return lang;
}

export function previewClinicPath(lang: Locale, clinicId: string, role: string, section?: string) {
  const base = `/${lang}/preview/c/${clinicId}/${role}`;
  return section && section !== "overview" ? `${base}/${section}` : base;
}

/**
 * Renders the clinic shell with synthetic memberships, through the SAME
 * resolver, capability and navigation code as the real workspace.
 */
export function PreviewClinicFrame({
  lang: rawLang,
  clinicId,
  role,
  section,
}: {
  lang: string;
  clinicId: string;
  role: string;
  section: string;
}): ReactNode {
  const lang = assertPreview(rawLang);
  if (!isClinicRole(role)) notFound();
  const clinic = findDemoClinic(clinicId);
  const memberships = demoMemberships(role, lang);
  const membership = resolveActiveClinic(memberships, clinicId);
  if (!clinic || !membership) notFound();

  const dict = getDictionary(lang);
  const capabilitySet = effectiveCapabilities(membership.roles, membership.grants);
  if (!(buildClinicNavigation(capabilitySet, membership.clinicState) as string[]).includes(section)) notFound();
  const activeSection = section as ClinicSection;
  const basePath = previewClinicPath(lang, clinicId, role);

  return (
    <AppShell
      appName={dict.common.appName}
      homeHref={basePath}
      banner={<PreviewBanner text={dict.preview.banner} />}
      navItems={clinicNavItems(dict, capabilitySet, membership.clinicState, basePath, activeSection)}
      navLabel={dict.shell.mainNavigation}
      menuLabel={dict.common.menu}
      closeLabel={dict.common.menu}
      headerStart={
        <ClinicSwitcher
          clinics={demoClinics.map((c) => ({
            id: c.id,
            name: c.name[lang],
            href: previewClinicPath(lang, c.id, role),
            stateLabel: dict.clinicStates[c.state],
          }))}
          activeId={clinicId}
          label={dict.shell.switchClinic}
          heading={dict.shell.yourClinics}
        />
      }
      headerEnd={
        <>
          <RoleSwitcher
            label={dict.shell.previewRole}
            activeRole={role}
            roles={demoRoles.map((r) => ({
              role: r,
              label: dict.roles[r],
              href: previewClinicPath(lang, clinicId, r),
            }))}
          />
          <LocaleSwitcher target={lang === "ar" ? "en" : "ar"} label={dict.common.otherLanguage} />
          <UserMenu
            displayName={dict.shell.previewUser}
            signedInAsLabel={dict.shell.signedInAs}
            signOutLabel={dict.common.signOut}
            locale={lang}
            canSignOut={false}
          />
        </>
      }
    >
      {activeSection === "overview" ? (
        <ClinicDashboardPreview dict={dict} locale={lang} clinic={clinic} role={role} capabilitySet={capabilitySet} />
      ) : (
        <SectionPlaceholder
          dict={dict}
          title={dict.nav[activeSection]}
          milestone={clinicSectionDefinitions[activeSection].milestone}
          requirements={clinicSectionDefinitions[activeSection].requirements}
        />
      )}
    </AppShell>
  );
}

export function PreviewAdminFrame({ lang: rawLang, section }: { lang: string; section: string }): ReactNode {
  const lang = assertPreview(rawLang);
  if (!(adminSections as readonly string[]).includes(section)) notFound();
  const activeSection = section as AdminSection;
  const dict = getDictionary(lang);
  const basePath = `/${lang}/preview/admin`;
  const definition = adminSectionDefinitions[activeSection];

  return (
    <AppShell
      appName={dict.common.appName}
      homeHref={basePath}
      banner={<PreviewBanner text={dict.preview.banner} />}
      navItems={adminNavItems(dict, basePath, activeSection)}
      navLabel={dict.shell.mainNavigation}
      menuLabel={dict.common.menu}
      closeLabel={dict.common.menu}
      headerStart={<Badge variant="secondary">{dict.shell.platformAdmin}</Badge>}
      headerEnd={
        <>
          <LocaleSwitcher target={lang === "ar" ? "en" : "ar"} label={dict.common.otherLanguage} />
          <UserMenu
            displayName={dict.shell.previewUser}
            signedInAsLabel={dict.shell.signedInAs}
            signOutLabel={dict.common.signOut}
            locale={lang}
            canSignOut={false}
          />
        </>
      }
    >
      {activeSection === "overview" ? (
        <AdminDashboardPreview dict={dict} locale={lang} />
      ) : (
        <SectionPlaceholder
          dict={dict}
          title={dict.adminNav[activeSection]}
          milestone={definition.milestone}
          requirements={definition.requirements}
        />
      )}
    </AppShell>
  );
}
