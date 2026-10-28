import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getWorkspace } from "@/lib/tenancy/workspace";

export default async function OverviewPage() {
  const locale = await getLocale();
  const workspace = await getWorkspace();
  if (!workspace) redirect(`/${locale}/login`);
  const { active } = workspace;
  const t = await getTranslations("overview");
  const ts = await getTranslations("shell");

  if (!active) {
    return (
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>
            <h1 className="text-lg">{t("noClinicTitle")}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{t("noClinicBody")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid max-w-3xl gap-4">
      <h1 className="text-2xl font-semibold">{active.name}</h1>
      {active.accountState === "pending" ? (
        <p role="status" className="rounded-md bg-warning p-3 text-sm text-warning-foreground">
          {t("pendingNotice")}
        </p>
      ) : null}
      {active.accountState === "suspended" ? (
        <p role="status" className="rounded-md bg-warning p-3 text-sm text-warning-foreground">
          {t("suspendedNotice")}
        </p>
      ) : null}
      <dl className="grid gap-4 sm:grid-cols-2">
        <Card className="gap-2 py-4">
          <CardContent>
            <dt className="text-sm text-muted-foreground">{t("yourRole")}</dt>
            <dd className="text-lg font-medium">{ts(`roles.${active.role}`)}</dd>
          </CardContent>
        </Card>
        <Card className="gap-2 py-4">
          <CardContent>
            <dt className="text-sm text-muted-foreground">{t("accountState")}</dt>
            <dd className="text-lg font-medium">{t(`states.${active.accountState}`)}</dd>
          </CardContent>
        </Card>
      </dl>
    </div>
  );
}
