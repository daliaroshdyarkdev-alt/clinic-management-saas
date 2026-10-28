import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ClinicSwitcher } from "@/components/shell/clinic-switcher";
import { DevNotice } from "@/components/shell/dev-notice";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { SideNav } from "@/components/shell/side-nav";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { signOut } from "@/lib/auth/actions";
import { getWorkspace } from "@/modules/tenancy/workspace";

export default async function AppLayout({ children }: LayoutProps<"/[locale]/app">) {
  const locale = await getLocale();
  const workspace = await getWorkspace();
  // The proxy already redirects anonymous visitors; this is the authoritative check.
  if (!workspace) redirect(`/${locale}/login`);
  const { active, clinics, capabilities, isPlatformAdmin } = workspace;
  const t = await getTranslations("shell");

  return (
    <div className="flex min-h-dvh flex-col">
      <DevNotice />
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {active ? (
            <ClinicSwitcher
              clinics={clinics.map(({ clinicId, name }) => ({ clinicId, name }))}
              activeClinicId={active.clinicId}
            />
          ) : null}
          {active ? (
            <span className="hidden text-xs text-muted-foreground sm:inline">{t(`roles.${active.role}`)}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {isPlatformAdmin ? (
            <Link href="/admin" className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent">
              {t("platformAdmin")}
            </Link>
          ) : null}
          <LocaleSwitcher />
          <form action={signOut}>
            <input type="hidden" name="locale" value={locale} />
            <Button type="submit" variant="ghost" size="sm">
              {t("signOut")}
            </Button>
          </form>
        </div>
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        {active ? (
          <aside className="border-b p-2 md:w-60 md:shrink-0 md:border-b-0 md:border-e md:p-4">
            <SideNav role={active.role} capabilities={capabilities} />
          </aside>
        ) : null}
        {/* Keyed by clinic: switching clinics remounts all client state. */}
        <main key={active?.clinicId ?? "none"} className="flex-1 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
