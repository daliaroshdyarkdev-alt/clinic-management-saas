import { redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { getClinicTrial } from "@/modules/onboarding/queries";
import { getWorkspace } from "@/modules/tenancy/workspace";

export default async function OverviewPage() {
  const locale = await getLocale();
  const workspace = await getWorkspace();
  if (!workspace) redirect(`/${locale}/login`);
  const { active } = workspace;
  const t = await getTranslations("overview");
  const ts = await getTranslations("shell");
  const format = await getFormatter();

  if (!active) {
    return (
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>
            <h1 className="text-lg">{t("noClinicTitle")}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-muted-foreground">{t("noClinicBody")}</p>
          <div>
            <Button asChild>
              <Link href="/app/clinics/new">{t("registerClinic")}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const trial = active.role === "owner" ? await getClinicTrial(active.clinicId) : null;

  return (
    <div className="grid max-w-3xl gap-4">
      <h1 className="text-2xl font-semibold">{active.name}</h1>
      {active.accountState === "pending" ? (
        <div role="status" className="grid gap-2 rounded-md bg-warning p-3 text-sm text-warning-foreground">
          <p>{t("pendingNotice")}</p>
          {active.role === "owner" ? (
            <Link href="/app/onboarding" className="font-medium underline underline-offset-4">
              {t("goToOnboarding")}
            </Link>
          ) : null}
        </div>
      ) : null}
      {active.accountState === "suspended" ? (
        <p role="status" className="rounded-md bg-warning p-3 text-sm text-warning-foreground">
          {t("suspendedNotice")}
        </p>
      ) : null}
      {active.accountState === "closed" ? (
        <p role="status" className="rounded-md bg-warning p-3 text-sm text-warning-foreground">
          {t("closedNotice")}
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
        {trial ? (
          <Card className="gap-2 py-4">
            <CardContent>
              <dt className="text-sm text-muted-foreground">{t("trialEnds")}</dt>
              <dd className="text-lg font-medium">
                {format.dateTime(new Date(trial.trial_ends_at), { dateStyle: "long" })}
              </dd>
            </CardContent>
          </Card>
        ) : null}
      </dl>
    </div>
  );
}
