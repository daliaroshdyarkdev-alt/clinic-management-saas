import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { enterRouteLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { addDays, cairoToday } from "@/lib/time/dates";
import { approveRequest, rejectRequest } from "@/modules/booking-requests/actions";
import { getOpenRequests } from "@/modules/booking-requests/queries";
import { getClinicDoctors, getSessionAvailability, getSessions } from "@/modules/scheduling/queries";
import { getWorkspace } from "@/modules/tenancy/workspace";
import { ProposeForm } from "./propose-form";

export default async function RequestsPage({ params }: PageProps<"/[locale]/app/requests">) {
  enterRouteLocale((await params).locale);
  const t = await getTranslations("requests");
  const format = await getFormatter();
  const workspace = await getWorkspace();
  const clinic = workspace?.active;
  if (!workspace || !clinic || !workspace.capabilities.includes("appointments.manage")) {
    return <p className="text-muted-foreground">{t("noAccess")}</p>;
  }

  const requests = await getOpenRequests(clinic.clinicId);
  const today = cairoToday();
  const [doctors, sessions] = await Promise.all([
    getClinicDoctors(clinic.clinicId),
    requests.length ? getSessions(clinic.clinicId, today, addDays(today, 14)) : Promise.resolve([]),
  ]);
  const names = new Map(doctors.map((d) => [d.id, d.display_name]));
  const open = sessions.filter((s) => s.status === "scheduled" && new Date(s.ends_at) > new Date());
  const availability = new Map(
    await Promise.all(open.map(async (s) => [s.id, await getSessionAvailability(s.id)] as const)),
  );
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const requestedSession = new Map(sessions.map((s) => [s.id, s]));

  // Alternative choices for a doctor: queue sessions with places, or free timed slots.
  const optionsFor = (doctorId: string) =>
    open
      .filter((s) => s.clinic_doctor_id === doctorId)
      .flatMap((s) => {
        const a = availability.get(s.id);
        if (s.method === "queue") {
          return (a?.remaining ?? 0) > 0
            ? [{ value: s.id, label: `${when(s.starts_at)} · ${t("placesLeft", { n: a?.remaining ?? 0 })}` }]
            : [];
        }
        return (a?.free_slots ?? []).slice(0, 12).map((slot) => ({ value: `${s.id}|${slot}`, label: when(slot) }));
      });

  return (
    <div className="grid max-w-4xl gap-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      {requests.length === 0 ? <p className="text-muted-foreground">{t("none")}</p> : null}
      {requests.map((r) => {
        const session = requestedSession.get(r.session_id);
        return (
          <Card key={r.id} className={r.needs_attention ? "border-destructive" : undefined}>
            <CardHeader>
              <CardTitle>
                <h2 className="text-base">
                  {r.requester_name} · <span dir="ltr">{r.requester_phone_e164}</span>
                </h2>
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {names.get(r.clinic_doctor_id)} ·{" "}
                {r.requested_starts_at ? when(r.requested_starts_at) : session ? when(session.starts_at) : ""} ·{" "}
                <span className="font-medium text-foreground">{t(`status.${r.status}`)}</span>
                {r.needs_attention ? ` · ${t("needsAttention")}` : ""}
              </p>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm md:grid-cols-3">
              {r.status !== "alternative_proposed" ? (
                <ActionForm action={approveRequest}>
                  <input type="hidden" name="requestId" value={r.id} />
                  <label className="grid gap-1">
                    {t("chartNumber")}
                    <Input name="chartNumber" type="number" min={1} required />
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t("registerFirst")}{" "}
                    <Link href="/app/patients" className="underline">
                      {t("patientsLink")}
                    </Link>
                  </p>
                  <div>
                    <SubmitButton size="sm">{t("approve")}</SubmitButton>
                  </div>
                </ActionForm>
              ) : (
                <p className="text-muted-foreground">{t("waitingForPatient")}</p>
              )}
              <ProposeForm requestId={r.id} options={optionsFor(r.clinic_doctor_id)} />
              <ActionForm action={rejectRequest}>
                <input type="hidden" name="requestId" value={r.id} />
                <label className="grid gap-1">
                  {t("reason")}
                  <Input name="reason" required maxLength={500} />
                </label>
                <div>
                  <SubmitButton size="sm" variant="outline">
                    {t("reject")}
                  </SubmitButton>
                </div>
              </ActionForm>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
