import "server-only";

import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { adminNavItems } from "@/components/shell/build-nav";
import { AppShell } from "@/components/shell/app-shell";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";
import { UserMenu } from "@/components/shell/user-menu";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/session";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { adminSectionDefinitions, adminSections, type AdminSection } from "@/modules/permissions/navigation";
import { getTenancyRepository } from "@/modules/tenancy/repository";

/**
 * Platform admin console gate (ADM-001). Platform admins are a separate realm
 * from clinic memberships and get no clinic medical/finance access (ADM-003).
 */
export async function AdminConsole({ lang, section }: { lang: string; section: string }): Promise<ReactNode> {
  if (!isLocale(lang)) notFound();
  if (!(adminSections as readonly string[]).includes(section)) notFound();
  const activeSection = section as AdminSection;
  const dict = getDictionary(lang);
  const basePath = `/${lang}/admin`;
  const user = await requireUser(lang, activeSection === "overview" ? basePath : `${basePath}/${activeSection}`);
  if (!(await getTenancyRepository().isPlatformAdmin(user.id))) notFound();

  const definition = adminSectionDefinitions[activeSection];
  return (
    <AppShell
      appName={dict.common.appName}
      homeHref={basePath}
      navItems={adminNavItems(dict, basePath, activeSection)}
      navLabel={dict.shell.mainNavigation}
      menuLabel={dict.common.menu}
      closeLabel={dict.common.menu}
      headerStart={<Badge variant="secondary">{dict.shell.platformAdmin}</Badge>}
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
      <SectionPlaceholder
        dict={dict}
        title={dict.adminNav[activeSection]}
        milestone={Math.max(definition.milestone, 1)}
        requirements={definition.requirements}
      />
    </AppShell>
  );
}
