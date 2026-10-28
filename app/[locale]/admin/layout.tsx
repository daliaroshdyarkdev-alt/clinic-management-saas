import { getTranslations } from "next-intl/server";
import { DevNotice } from "@/components/shell/dev-notice";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { Button } from "@/components/ui/button";
import { enterRouteLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { signOut } from "@/lib/auth/actions";
import { requirePlatformAdmin } from "@/modules/platform-admin/guard";

export default async function AdminLayout({ children, params }: LayoutProps<"/[locale]/admin">) {
  const locale = enterRouteLocale((await params).locale);
  await requirePlatformAdmin(locale);
  const t = await getTranslations("admin");
  const ts = await getTranslations("shell");

  return (
    <div className="flex min-h-dvh flex-col">
      <DevNotice />
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2 sm:px-6">
        <Link href="/admin" className="font-semibold">
          {t("title")}
        </Link>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <form action={signOut}>
            <input type="hidden" name="locale" value={locale} />
            <Button type="submit" variant="ghost" size="sm">
              {ts("signOut")}
            </Button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
