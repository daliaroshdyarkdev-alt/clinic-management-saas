import { getTranslations } from "next-intl/server";
import { enterRouteLocale } from "@/i18n/locale";
import { DevNotice } from "@/components/shell/dev-notice";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default async function LoginPage({ params, searchParams }: PageProps<"/[locale]/login">) {
  enterRouteLocale((await params).locale);
  const { next } = await searchParams;
  const t = await getTranslations("login");

  return (
    <div className="flex min-h-dvh flex-col">
      <DevNotice />
      <div className="flex justify-end px-4 py-3 sm:px-8">
        <LocaleSwitcher />
      </div>
      <main className="flex flex-1 items-start justify-center px-4 pt-12">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>
              <h1 className="text-xl">{t("title")}</h1>
            </CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm next={typeof next === "string" ? next : undefined} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
