import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { z } from "zod";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { enterRouteLocale } from "@/i18n/locale";
import { getClinicLicenses, getClinicTrial } from "@/modules/onboarding/queries";
import { extendTrial, requestReverification } from "@/modules/billing/actions";
import { getBillingStatus, getReverificationRequests, getTrialExtensions } from "@/modules/billing/queries";
import { activateClinic, reviewLicense, setClinicState } from "@/modules/platform-admin/actions";
import { requirePlatformAdmin } from "@/modules/platform-admin/guard";
import { getAdminClinic } from "@/modules/platform-admin/queries";

const LICENSE_TYPES = ["clinic_operating", "doctor_professional"] as const;
const NEXT_STATES = {
  pending: ["closed"],
  active: ["suspended", "closed"],
  suspended: ["active", "closed"],
  closed: [],
} as const;

export default async function AdminClinicPage({ params }: PageProps<"/[locale]/admin/clinics/[clinicId]">) {
  const { locale: rawLocale, clinicId } = await params;
  const locale = enterRouteLocale(rawLocale);
  await requirePlatformAdmin(locale);
  if (!z.uuid().safeParse(clinicId).success) notFound();

  const detail = await getAdminClinic(clinicId);
  if (!detail) notFound();
  const [licenses, trial, billing, extensions, reverifications] = await Promise.all([
    getClinicLicenses(clinicId),
    getClinicTrial(clinicId),
    getBillingStatus(clinicId),
    getTrialExtensions(clinicId),
    getReverificationRequests(clinicId),
  ]);
  const tb = await getTranslations("billing");

  const t = await getTranslations("admin");
  const to = await getTranslations("onboarding");
  const ts = await getTranslations("overview.states");
  const format = await getFormatter();
  const formatDate = (v: string) => format.dateTime(new Date(v), { dateStyle: "medium", timeStyle: "short" });
  const { clinic, owner } = detail;

  return (
    <div className="grid max-w-4xl gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{clinic.name}</h1>
        <p className="text-muted-foreground">
          {ts(clinic.account_state)} · {t("registeredAt", { date: formatDate(clinic.created_at) })}
        </p>
        {trial ? (
          <p className="text-sm">
            {t("trial", { start: formatDate(trial.trial_started_at), end: formatDate(trial.trial_ends_at) })}
          </p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("owner")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {owner ? (
            <p>
              {owner.full_name} · <span dir="ltr">{owner.email}</span>
              {owner.phone_e164 ? (
                <>
                  {" "}
                  · <span dir="ltr">{owner.phone_e164}</span>
                </>
              ) : null}
            </p>
          ) : (
            <p className="text-muted-foreground">{t("noOwner")}</p>
          )}
        </CardContent>
      </Card>

      {LICENSE_TYPES.map((type) => {
        const current = licenses.find((l) => l.license_type === type && l.review_status !== "superseded");
        return (
          <Card key={type}>
            <CardHeader>
              <CardTitle>
                <h2 className="text-lg">{to(`types.${type}`)}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {current ? (
                <>
                  <p>
                    {to(`reviewStatus.${current.review_status}`)} ·{" "}
                    {to("uploadedAt", { revision: current.revision, date: formatDate(current.uploaded_at) })}
                  </p>
                  {current.review_reason ? <p className="text-muted-foreground">{current.review_reason}</p> : null}
                  <a
                    href={`/api/licenses/${current.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-4"
                  >
                    {t("openFile")}
                  </a>
                  {current.review_status === "submitted" ? (
                    <ActionForm action={reviewLicense} successText={t("saved")}>
                      <input type="hidden" name="clinicId" value={clinic.id} />
                      <input type="hidden" name="licenseId" value={current.id} />
                      <label htmlFor={`reason-${current.id}`} className="text-xs text-muted-foreground">
                        {t("reasonOptionalForApproval")}
                      </label>
                      <Input id={`reason-${current.id}`} name="reason" maxLength={1000} />
                      <div className="flex flex-wrap gap-2">
                        <SubmitButton size="sm" name="decision" value="approved">
                          {t("approve")}
                        </SubmitButton>
                        <SubmitButton size="sm" variant="outline" name="decision" value="replacement_requested">
                          {t("requestReplacement")}
                        </SubmitButton>
                        <SubmitButton size="sm" variant="outline" name="decision" value="rejected">
                          {t("reject")}
                        </SubmitButton>
                      </div>
                    </ActionForm>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground">{to("notUploaded")}</p>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("lifecycle")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {clinic.account_state === "pending" ? (
            <ActionForm action={activateClinic}>
              <input type="hidden" name="clinicId" value={clinic.id} />
              <p className="text-sm text-muted-foreground">{t("activateHint")}</p>
              <div>
                <SubmitButton>{t("activate")}</SubmitButton>
              </div>
            </ActionForm>
          ) : null}
          {NEXT_STATES[clinic.account_state].length > 0 ? (
            <ActionForm action={setClinicState}>
              <input type="hidden" name="clinicId" value={clinic.id} />
              <label htmlFor="state-reason" className="text-xs text-muted-foreground">
                {t("reasonRequired")}
              </label>
              <Input id="state-reason" name="reason" required maxLength={1000} />
              <div className="flex flex-wrap gap-2">
                {NEXT_STATES[clinic.account_state].map((s) => (
                  <SubmitButton key={s} size="sm" variant="outline" name="toState" value={s}>
                    {t(`setState.${s}`)}
                  </SubmitButton>
                ))}
              </div>
            </ActionForm>
          ) : null}
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">{t("history")}</summary>
            <ul className="mt-2 grid gap-1">
              {detail.events.map((e) => (
                <li key={e.id}>
                  {formatDate(e.occurred_at)} · {e.from_state ? ts(e.from_state) : "—"} → {ts(e.to_state)}
                  {e.reason ? ` · ${e.reason}` : ""}
                </li>
              ))}
              {detail.decisions.map((d) => (
                <li key={d.id}>
                  {formatDate(d.decided_at)} · {to(`reviewStatus.${d.decision}`)}
                  {d.reason ? ` · ${d.reason}` : ""}
                </li>
              ))}
            </ul>
          </details>
        </CardContent>
      </Card>

      {trial ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-lg">{tb("adminClinicTitle")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {billing ? (
              <p>
                {tb(`states.${billing.state}`)} ·{" "}
                {tb("capacity", { active: billing.active_doctors, capacity: billing.doctor_capacity })}
              </p>
            ) : null}
            <ActionForm action={extendTrial} className="sm:grid-cols-3 sm:items-end" successText={tb("saved")}>
              <input type="hidden" name="clinicId" value={clinic.id} />
              <label className="grid gap-1">
                {tb("extendDays")}
                <Input name="days" type="number" min={1} max={60} required defaultValue={7} />
              </label>
              <label className="grid gap-1 sm:col-span-2">
                {t("reasonRequired")}
                <Input name="reason" required maxLength={1000} />
              </label>
              <div>
                <SubmitButton size="sm" variant="outline">
                  {tb("extendTrial")}
                </SubmitButton>
              </div>
            </ActionForm>
            {extensions.length > 0 ? (
              <ul className="grid gap-1 text-xs text-muted-foreground">
                {extensions.map((e) => (
                  <li key={e.id}>
                    {formatDate(e.created_at)} · +{e.days} · {e.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            <ActionForm
              action={requestReverification}
              className="sm:grid-cols-3 sm:items-end"
              successText={tb("saved")}
            >
              <input type="hidden" name="clinicId" value={clinic.id} />
              <label className="grid gap-1">
                {tb("licenseType")}
                <select name="licenseType" className="h-9 rounded-md border border-input bg-background px-2">
                  {LICENSE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {to(`types.${type}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 sm:col-span-2">
                {t("reasonRequired")}
                <Input name="reason" required maxLength={1000} />
              </label>
              <div>
                <SubmitButton size="sm" variant="outline">
                  {tb("requestReverification")}
                </SubmitButton>
              </div>
            </ActionForm>
            {reverifications.map((r) => (
              <p key={r.id} className="text-xs">
                {tb("reverificationOpen", { type: to(`types.${r.license_type as "clinic_operating"}`) })}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
