import { getTranslations } from "next-intl/server";
import { DevNotice } from "@/components/shell/dev-notice";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { enterRouteLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { RegisterForm } from "./register-form";

export default async function RegisterPage({ params, searchParams }: PageProps<"/[locale]/register">) {
  enterRouteLocale((await params).locale);
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;
  const t = await getTranslations("register");

  return (
    <div className="flex min-h-dvh flex-col">
      <DevNotice />
      <div className="flex justify-end px-4 py-3 sm:px-8">
        <LocaleSwitcher />
      </div>
      <main className="flex flex-1 items-start justify-center px-4 py-8">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>
              <h1 className="text-xl">{t("title")}</h1>
            </CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <RegisterForm next={nextPath} />
            <p className="text-sm text-muted-foreground">
              {t("haveAccount")}{" "}
              <Link
                href={nextPath ? { pathname: "/login", query: { next: nextPath } } : "/login"}
                className="text-primary underline underline-offset-4"
              >
                {t("signIn")}
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
