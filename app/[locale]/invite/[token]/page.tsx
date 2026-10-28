import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { DevNotice } from "@/components/shell/dev-notice";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { enterRouteLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { acceptInvitation } from "@/modules/staff/actions";
import { getInvitationPreview } from "@/modules/staff/queries";

const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

export default async function InvitePage({ params }: PageProps<"/[locale]/invite/[token]">) {
  const { locale: rawLocale, token } = await params;
  const locale = enterRouteLocale(rawLocale);
  const t = await getTranslations("invite");
  const tr = await getTranslations("shell.roles");
  const format = await getFormatter();
  const user = await getCurrentUser();
  const self = `/${locale}/invite/${token}`;

  let body: React.ReactNode;
  if (!TOKEN.test(token)) {
    body = <p>{t("status.invalid")}</p>;
  } else if (!user) {
    body = (
      <div className="grid gap-3">
        <p>{t("signInFirst")}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={{ pathname: "/register", query: { next: self } }}>{t("createAccount")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={{ pathname: "/login", query: { next: self } }}>{t("signIn")}</Link>
          </Button>
        </div>
      </div>
    );
  } else {
    const preview = await getInvitationPreview(token);
    body =
      preview.status === "valid" && preview.clinic_name && preview.role ? (
        <div className="grid gap-4">
          <p>{t("summary", { clinic: preview.clinic_name, role: tr(preview.role) })}</p>
          {preview.expires_at ? (
            <p className="text-sm text-muted-foreground">
              {t("expires", { date: format.dateTime(new Date(preview.expires_at), { dateStyle: "medium" }) })}
            </p>
          ) : null}
          <ActionForm action={acceptInvitation}>
            <input type="hidden" name="token" value={token} />
            <div>
              <SubmitButton>{t("accept")}</SubmitButton>
            </div>
          </ActionForm>
        </div>
      ) : (
        <p>{t(`status.${preview.status === "valid" ? "invalid" : preview.status}`)}</p>
      );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <DevNotice />
      <div className="flex justify-end px-4 py-3 sm:px-8">
        <LocaleSwitcher />
      </div>
      <main className="flex flex-1 items-start justify-center px-4 py-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>
              <h1 className="text-xl">{t("title")}</h1>
            </CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </CardHeader>
          <CardContent>{body}</CardContent>
        </Card>
      </main>
    </div>
  );
}
