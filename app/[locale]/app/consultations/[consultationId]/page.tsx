import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { z } from "zod";
import { FieldValue } from "@/components/clinical/field-value";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { enterRouteLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { addCorrection, recordConsent, withdrawConsent } from "@/modules/clinical/actions";
import {
  getConsultation,
  getExternalGrants,
  getPatientHistory,
  patientOfAppointment,
} from "@/modules/clinical/queries";
import { ConsultationForm } from "./consultation-form";

export default async function ConsultationPage({ params }: PageProps<"/[locale]/app/consultations/[consultationId]">) {
  const { locale, consultationId } = await params;
  enterRouteLocale(locale);
  if (!z.uuid().safeParse(consultationId).success) notFound();
  const t = await getTranslations("consultation");
  const format = await getFormatter();
  const consultation = await getConsultation(consultationId);
  if (!consultation) return <p className="text-muted-foreground">{t("noAccess")}</p>;

  const patientId = await patientOfAppointment(consultation.appointment_id);
  const [history, grants] = await Promise.all([
    patientId ? getPatientHistory(patientId) : Promise.resolve([]),
    getExternalGrants(consultation.id),
  ]);
  const draft = consultation.status === "draft";
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const p = consultation.patient;

  return (
    <div className="grid max-w-4xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {p.full_name} <span className="text-muted-foreground">#{p.chart_number}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          {p.date_of_birth} · {t(`gender.${p.gender}`)} · {t(`status.${consultation.status}`)} ·{" "}
          {date(consultation.started_at)}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("record")}</h2>
          </CardTitle>
          {!draft && consultation.completed_at ? (
            <CardDescription>{t("lockedAt", { date: date(consultation.completed_at) })}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-4">
          {draft ? (
            <ConsultationForm
              consultationId={consultation.id}
              fields={consultation.fields}
              values={consultation.values}
            />
          ) : (
            <dl className="grid gap-3 text-sm">
              {consultation.fields.map((f) => (
                <div key={f.key}>
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd>
                    <FieldValue field={f} value={consultation.values[f.key]} yes={t("yes")} no={t("no")} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {consultation.archived.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">{t("archived")}</summary>
              <dl className="mt-2 grid gap-2">
                {consultation.archived.map((a) => (
                  <div key={a.key}>
                    <dt className="text-muted-foreground">{a.label}</dt>
                    <dd>
                      <FieldValue value={a.value} yes={t("yes")} no={t("no")} />
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}
        </CardContent>
      </Card>

      {!draft ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-lg">{t("corrections")}</h2>
            </CardTitle>
            <CardDescription>{t("correctionsHint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {consultation.corrections.map((c, i) => (
              <p key={i} className="whitespace-pre-wrap rounded-md bg-accent p-2">
                <span className="text-muted-foreground">{date(c.created_at)} · </span>
                {c.body}
              </p>
            ))}
            <ActionForm action={addCorrection}>
              <input type="hidden" name="consultationId" value={consultation.id} />
              <textarea
                name="body"
                required
                maxLength={5000}
                rows={3}
                className="rounded-md border border-input bg-background px-3 py-2"
              />
              <div>
                <SubmitButton size="sm" variant="outline">
                  {t("addCorrection")}
                </SubmitButton>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      {draft ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-lg">{t("externalTitle")}</h2>
            </CardTitle>
            <CardDescription>{t("externalDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <ActionForm action={recordConsent} className="sm:grid-cols-2" successText={t("consentRecorded")}>
              <input type="hidden" name="consultationId" value={consultation.id} />
              <label className="grid gap-1">
                {t("phone")}
                <Input name="phone" required dir="ltr" pattern="\+[1-9][0-9]{6,14}" />
              </label>
              <label className="grid gap-1">
                {t("dateOfBirth")}
                <Input name="dateOfBirth" type="date" required />
              </label>
              <label className="grid gap-1">
                {t("identification")}
                <Input name="identification" maxLength={100} />
              </label>
              <label className="grid gap-1">
                {t("evidence")}
                <Input name="evidence" required minLength={3} maxLength={1000} placeholder={t("evidenceHint")} />
              </label>
              <p className="text-xs text-muted-foreground sm:col-span-2">{t("consentStatement")}</p>
              <div>
                <SubmitButton size="sm">{t("recordConsent")}</SubmitButton>
              </div>
            </ActionForm>
            {grants.length > 0 ? (
              <ul className="divide-y rounded-md border">
                {grants.map((g) => (
                  <li key={g.grant_id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                    <span>
                      {g.source_clinic_name} · {t("recordsCount", { n: g.records })}
                      {g.revoked_at ? ` · ${t(`revoked.${g.revoke_reason ?? "patient_withdrew"}`)}` : ""}
                    </span>
                    {!g.revoked_at ? (
                      <span className="flex gap-2">
                        <Link
                          href={`/app/consultations/${consultation.id}/external/${g.grant_id}`}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {t("viewExternal")}
                        </Link>
                        <ActionForm action={withdrawConsent}>
                          <input type="hidden" name="grantId" value={g.grant_id} />
                          <input type="hidden" name="consultationId" value={consultation.id} />
                          <SubmitButton size="sm" variant="ghost">
                            {t("withdraw")}
                          </SubmitButton>
                        </ActionForm>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {history.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-lg">{t("history")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {history
                .filter((h) => h.id !== consultation.id)
                .map((h) => (
                  <li key={h.id}>
                    <Link
                      href={`/app/consultations/${h.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {date(h.started_at)}
                    </Link>{" "}
                    · {t(`status.${h.status}`)}
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
