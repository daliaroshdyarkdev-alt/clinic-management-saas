import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { enterRouteLocale } from "@/i18n/locale";
import { getClinicLicenses, getClinicTrial, type LicenseRecord } from "@/modules/onboarding/queries";
import { getWorkspace } from "@/modules/tenancy/workspace";
import { LicenseUploadForm } from "./license-upload-form";

const LICENSE_TYPES = ["clinic_operating", "doctor_professional"] as const;

export default async function OnboardingPage({ params }: PageProps<"/[locale]/app/onboarding">) {
  enterRouteLocale((await params).locale);
  const t = await getTranslations("onboarding");
  const format = await getFormatter();
  const workspace = await getWorkspace();
  const clinic = workspace?.active;

  if (!clinic || clinic.role !== "owner") {
    return <p className="text-muted-foreground">{t("ownerOnly")}</p>;
  }

  const [licenses, trial] = await Promise.all([getClinicLicenses(clinic.clinicId), getClinicTrial(clinic.clinicId)]);
  const canUpload = clinic.accountState === "pending" || clinic.accountState === "active";
  const formatDate = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="grid max-w-3xl gap-6">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">
          {clinic.accountState === "pending" ? t("pendingIntro") : t(`stateIntro.${clinic.accountState}`)}
        </p>
        {trial ? (
          <p className="text-sm">
            {t("trialEnds", { date: format.dateTime(new Date(trial.trial_ends_at), { dateStyle: "long" }) })}
          </p>
        ) : null}
      </div>

      {LICENSE_TYPES.map((type) => {
        const history = licenses.filter((l) => l.license_type === type);
        const current: LicenseRecord | undefined = history.find((l) => l.review_status !== "superseded");
        return (
          <Card key={type}>
            <CardHeader>
              <CardTitle>
                <h2 className="text-lg">{t(`types.${type}`)}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {current ? (
                <div className="grid gap-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">{t("status")}: </span>
                    <span className="font-medium">{t(`reviewStatus.${current.review_status}`)}</span>
                  </p>
                  <p className="text-muted-foreground">
                    {t("uploadedAt", { revision: current.revision, date: formatDate(current.uploaded_at) })}
                  </p>
                  {current.review_reason ? (
                    <p>
                      <span className="text-muted-foreground">{t("reviewerNote")}: </span>
                      {current.review_reason}
                    </p>
                  ) : null}
                  <a
                    href={`/api/licenses/${current.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {t("viewFile")}
                  </a>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("notUploaded")}</p>
              )}
              {canUpload && current?.review_status !== "approved" ? <LicenseUploadForm licenseType={type} /> : null}
              {history.length > 1 ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">{t("history")}</summary>
                  <ul className="mt-2 grid gap-1">
                    {history.map((l) => (
                      <li key={l.id}>
                        {t("historyLine", {
                          revision: l.revision,
                          status: t(`reviewStatus.${l.review_status}`),
                          date: formatDate(l.uploaded_at),
                        })}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
