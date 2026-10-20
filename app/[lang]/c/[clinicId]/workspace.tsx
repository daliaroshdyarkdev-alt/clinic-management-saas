import "server-only";

import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { clinicNavItems } from "@/components/shell/build-nav";
import { AppShell } from "@/components/shell/app-shell";
import { ClinicSwitcher } from "@/components/shell/clinic-switcher";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";
import { UserMenu } from "@/components/shell/user-menu";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { effectiveCapabilities } from "@/modules/permissions/capabilities";
import { buildClinicNavigation, clinicSectionDefinitions, type ClinicSection } from "@/modules/permissions/navigation";
import { resolveActiveClinic, switchableClinics } from "@/modules/tenancy/active-clinic";
import { getTenancyRepository } from "@/modules/tenancy/repository";

/**
 * Server-side gate and frame for every clinic workspace page (invariant 2):
 * verified user → that user's memberships → active membership for the URL
 * clinic → capabilities → section visibility. Any failure is a 404.
 */
export async function ClinicWorkspace({
  lang,
  clinicId,
  section,
}: {
  lang: string;
  clinicId: string;
  section: string;
}): Promise<ReactNode> {
  if (!isLocale(lang)) notFound();
  const dict = getDictionary(lang);
  const basePath = `/${lang}/c/${clinicId}`;
  const user = await requireUser(lang, section === "overview" ? basePath : `${basePath}/${section}`);

  const memberships = await getTenancyRepository().listMemberships(user.id);
  const membership = resolveActiveClinic(memberships, clinicId);
  if (!membership) notFound();

  const capabilitySet = effectiveCapabilities(membership.roles, membership.grants);
  const visible = buildClinicNavigation(capabilitySet, membership.clinicState);
  if (!(visible as string[]).includes(section)) notFound();
  const activeSection = section as ClinicSection;

  const switcherClinics = switchableClinics(memberships).map((m) => ({
    id: m.clinicId,
    name: m.clinicName,
    href: `/${lang}/c/${m.clinicId}`,
    stateLabel: dict.clinicStates[m.clinicState],
  }));

  return (
    <AppShell
      appName={dict.common.appName}
      homeHref={basePath}
      navItems={clinicNavItems(dict, capabilitySet, membership.clinicState, basePath, activeSection)}
      navLabel={dict.shell.mainNavigation}
      menuLabel={dict.common.menu}
      closeLabel={dict.common.menu}
      headerStart={
        <ClinicSwitcher
          clinics={switcherClinics}
          activeId={membership.clinicId}
          label={dict.shell.switchClinic}
          heading={dict.shell.yourClinics}
        />
      }
      headerEnd={
        <>
          <LocaleSwitcher target={lang === "ar" ? "en" : "ar"} label={dict.common.otherLanguage} />
          <UserMenu
            displayName={user.email ?? user.id.slice(0, 8)}
            signedInAsLabel={dict.shell.signedInAs}
            signOutLabel={dict.common.signOut}
            locale={lang}
            canSignOut
          />
        </>
      }
    >
      {activeSection === "overview" ? (
        <Card className="mx-auto max-w-3xl">
          <CardHeader>
            <CardTitle>{membership.clinicName}</CardTitle>
            <CardDescription className="flex flex-wrap gap-2">
              <Badge variant="outline">{dict.clinicStates[membership.clinicState]}</Badge>
              {membership.roles.map((role) => (
                <Badge key={role} variant="secondary">
                  {dict.roles[role]}
                </Badge>
              ))}
            </CardDescription>
          </CardHeader>
        </Card>
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
