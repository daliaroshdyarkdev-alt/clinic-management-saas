import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { enterRouteLocale } from "@/i18n/locale";
import { reviewDuplicate } from "@/modules/clinical/actions";
import { recordConsent } from "@/modules/messaging/actions";
import { getConsents } from "@/modules/messaging/queries";
import { registerPatient } from "@/modules/patients/actions";
import { getOpenDuplicates, searchPatients } from "@/modules/patients/queries";
import { getWorkspace } from "@/modules/tenancy/workspace";

export default async function PatientsPage({ params, searchParams }: PageProps<"/[locale]/app/patients">) {
  enterRouteLocale((await params).locale);
  const t = await getTranslations("patients");
  const workspace = await getWorkspace();
  const clinic = workspace?.active;
  if (!workspace || !clinic || !workspace.capabilities.includes("appointments.manage")) {
    return <p className="text-muted-foreground">{t("noAccess")}</p>;
  }
  const { q } = await searchParams;
  const term = typeof q === "string" ? q.slice(0, 100) : "";
  const [patients, duplicates] = await Promise.all([
    searchPatients(clinic.clinicId, term),
    getOpenDuplicates(clinic.clinicId),
  ]);
  const consents = await getConsents(
    clinic.clinicId,
    patients.map((p) => p.id),
  );

  return (
    <div className="grid max-w-4xl gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {duplicates.length > 0 ? (
        <Card className="border-warning">
          <CardHeader>
            <CardTitle>
              <h2 className="text-lg">{t("duplicatesTitle")}</h2>
            </CardTitle>
            <CardDescription>{t("duplicatesDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border">
              {duplicates.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span>
                    #{d.chartA} ↔ #{d.chartB} · {d.reasons.map((r) => t(`reason.${r}`)).join("، ")}
                  </span>
                  <span className="flex gap-2">
                    <ActionForm action={reviewDuplicate}>
                      <input type="hidden" name="candidateId" value={d.id} />
                      <input type="hidden" name="status" value="not_duplicate" />
                      <SubmitButton size="sm" variant="outline">
                        {t("notDuplicate")}
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={reviewDuplicate}>
                      <input type="hidden" name="candidateId" value={d.id} />
                      <input type="hidden" name="status" value="confirmed_duplicate" />
                      <SubmitButton size="sm" variant="outline">
                        {t("confirmDuplicate")}
                      </SubmitButton>
                    </ActionForm>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      <form className="flex flex-wrap items-end gap-2">
        <label className="grid flex-1 gap-1 text-sm">
          {t("search")}
          <Input name="q" defaultValue={term} placeholder={t("searchHint")} />
        </label>
        <Button type="submit" variant="outline">
          {t("searchSubmit")}
        </Button>
      </form>
      <ul className="divide-y rounded-md border">
        {patients.map((p) => (
          <li key={p.id} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
            <span className="font-medium">
              #{p.chart_number} · {p.identity.full_name}
            </span>
            <span className="text-muted-foreground">
              <span dir="ltr">{p.identity.phone_e164}</span> · {p.identity.date_of_birth}
            </span>
            <span className="flex w-full flex-wrap items-center gap-2 text-xs">
              {t(`whatsappConsent.${consents.has(p.id) ? (consents.get(p.id) ? "granted" : "withdrawn") : "unknown"}`)}
              <ActionForm action={recordConsent}>
                <input type="hidden" name="patientId" value={p.id} />
                <input type="hidden" name="granted" value={consents.get(p.id) ? "false" : "true"} />
                <SubmitButton size="sm" variant="ghost">
                  {consents.get(p.id) ? t("withdrawConsent") : t("recordConsent")}
                </SubmitButton>
              </ActionForm>
            </span>
          </li>
        ))}
        {patients.length === 0 ? <li className="p-3 text-sm text-muted-foreground">{t("none")}</li> : null}
      </ul>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("registerTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("registerDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={registerPatient} className="sm:grid-cols-2" successText={t("registered")}>
            <label className="grid gap-1 text-sm">
              {t("fullName")}
              <Input name="fullName" required minLength={2} maxLength={200} />
            </label>
            <label className="grid gap-1 text-sm">
              {t("phone")}
              <Input name="phone" required dir="ltr" placeholder="+2010XXXXXXXX" pattern="\+[1-9][0-9]{6,14}" />
            </label>
            <label className="grid gap-1 text-sm">
              {t("dateOfBirth")}
              <Input name="dateOfBirth" type="date" required />
            </label>
            <label className="grid gap-1 text-sm">
              {t("gender")}
              <select name="gender" required className="h-9 rounded-md border border-input bg-background px-2">
                <option value="female">{t("female")}</option>
                <option value="male">{t("male")}</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              {t("address")}
              <Input name="address" required minLength={2} maxLength={500} />
            </label>
            <label className="grid gap-1 text-sm">
              {t("identification")}
              <Input name="identification" maxLength={100} />
            </label>
            <label className="grid gap-1 text-sm">
              {t("language")}
              <select name="preferredLanguage" className="h-9 rounded-md border border-input bg-background px-2">
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </label>
            <p className="text-xs text-muted-foreground sm:col-span-2">{t("noMergeNote")}</p>
            <div>
              <SubmitButton>{t("registerSubmit")}</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
