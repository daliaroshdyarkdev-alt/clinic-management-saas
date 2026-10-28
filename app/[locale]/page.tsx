import { getTranslations } from "next-intl/server";
import { enterRouteLocale } from "@/i18n/locale";
import { Button } from "@/components/ui/button";
import { DevNotice } from "@/components/shell/dev-notice";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { Link } from "@/i18n/navigation";

export default async function LandingPage({ params }: PageProps<"/[locale]">) {
  enterRouteLocale((await params).locale);
  const t = await getTranslations();

  return (
    <div className="flex min-h-dvh flex-col">
      <DevNotice />
      <header className="flex items-center justify-between px-4 py-3 sm:px-8">
        <span className="font-semibold">{t("common.productName")}</span>
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-16 sm:px-8">
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">{t("landing.headline")}</h1>
        <p className="text-lg text-muted-foreground">{t("landing.body")}</p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/register">{t("landing.registerClinic")}</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">{t("landing.signIn")}</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
