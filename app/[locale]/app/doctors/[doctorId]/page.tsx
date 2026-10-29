import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { enterRouteLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { cairoToday } from "@/lib/time/dates";
import { addScheduleException, saveSchedulingPolicy } from "@/modules/scheduling/actions";
import { getClinicDoctors, getUpcomingExceptions, getWeeklySchedule } from "@/modules/scheduling/queries";
import { POLICY_OPTIONS } from "@/modules/scheduling/policy-options";
import { getWorkspace } from "@/modules/tenancy/workspace";
import { WeeklyEditor } from "./weekly-editor";

const OPTIONS = POLICY_OPTIONS;

export default async function DoctorSettingsPage({ params }: PageProps<"/[locale]/app/doctors/[doctorId]">) {
  const { locale: rawLocale, doctorId } = await params;
  enterRouteLocale(rawLocale);
  if (!z.uuid().safeParse(doctorId).success) notFound();
  const t = await getTranslations("doctors");
  const tp = await getTranslations("policy");
  const workspace = await getWorkspace();
  const clinic = workspace?.active;
  if (!workspace || !clinic) return null;

  const doctor = (await getClinicDoctors(clinic.clinicId)).find((d) => d.id === doctorId);
  if (!doctor) notFound();
  // Presentation guard; SQL allows only the doctor themselves or the owner.
  if (clinic.role !== "owner" && workspace.doctorId !== doctor.id)
    return <p className="text-muted-foreground">{t("noAccess")}</p>;

  const [weekly, exceptions] = await Promise.all([
    getWeeklySchedule(doctor.id),
    getUpcomingExceptions(doctor.id, cairoToday()),
  ]);
  const policy = doctor.policy;
  const select = (name: keyof typeof OPTIONS, value: string | undefined) => (
    <label className="grid gap-1 text-sm">
      {tp(`${name}.label`)}
      <select
        name={name}
        defaultValue={value}
        required
        className="h-9 rounded-md border border-input bg-background px-2"
      >
        {OPTIONS[name].map((o) => (
          <option key={o} value={o}>
            {(tp as (key: string) => string)(`${name}.${o}`)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="grid max-w-4xl gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{doctor.display_name}</h1>
        {workspace.doctorId === doctor.id ? (
          <Link
            href={`/app/doctors/${doctor.id}/template`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {t("editTemplate")}
          </Link>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("policyTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("policyDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveSchedulingPolicy} className="sm:grid-cols-2" successText={t("saved")}>
            <input type="hidden" name="clinicDoctorId" value={doctor.id} />
            {select("method", policy?.method)}
            <label className="grid gap-1 text-sm">
              {tp("slotMinutes")}
              <Input name="slotMinutes" type="number" min={5} max={240} defaultValue={policy?.slot_minutes ?? 15} />
            </label>
            {select("overbooking", policy?.overbooking)}
            {select("queueOrdering", policy?.queue_ordering)}
            {select("walkIn", policy?.walk_in)}
            {select("absentWhenCalled", policy?.absent_when_called)}
            {select("patientCancellation", policy?.patient_cancellation)}
            <p className="text-xs text-muted-foreground sm:col-span-2">{tp("manualOnlyNote")}</p>
            <div className="sm:col-span-2">
              <SubmitButton>{t("savePolicy")}</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("weeklyTitle")}</h2>
          </CardTitle>
          <CardDescription>{policy ? t("weeklyDescription") : t("policyFirst")}</CardDescription>
        </CardHeader>
        <CardContent>
          <WeeklyEditor
            clinicDoctorId={doctor.id}
            needsCapacity={policy?.method !== "timed"}
            initial={weekly.map((w) => ({
              weekday: w.weekday,
              start: w.start_time.slice(0, 5),
              end: w.end_time.slice(0, 5),
              capacity: w.capacity,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("exceptionsTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("exceptionsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ActionForm action={addScheduleException} className="sm:grid-cols-3 sm:items-end" successText={t("saved")}>
            <input type="hidden" name="clinicDoctorId" value={doctor.id} />
            <label className="grid gap-1 text-sm">
              {t("date")}
              <Input name="date" type="date" required min={cairoToday()} />
            </label>
            <label className="grid gap-1 text-sm">
              {t("kind")}
              <select name="kind" className="h-9 rounded-md border border-input bg-background px-2">
                <option value="day_off">{t("dayOff")}</option>
                <option value="extra_session">{t("extraSession")}</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              {t("reason")}
              <Input name="reason" maxLength={500} />
            </label>
            <label className="grid gap-1 text-sm">
              {t("from")}
              <Input name="start" type="time" />
            </label>
            <label className="grid gap-1 text-sm">
              {t("to")}
              <Input name="end" type="time" />
            </label>
            <label className="grid gap-1 text-sm">
              {t("capacity")}
              <Input name="capacity" type="number" min={1} max={500} />
            </label>
            <p className="text-xs text-muted-foreground sm:col-span-3">{t("exceptionHint")}</p>
            <div>
              <SubmitButton size="sm">{t("addException")}</SubmitButton>
            </div>
          </ActionForm>
          {exceptions.length > 0 ? (
            <ul className="grid gap-1 text-sm">
              {exceptions.map((e) => (
                <li key={e.id}>
                  {e.exception_date} ·{" "}
                  {e.kind === "day_off"
                    ? t("dayOff")
                    : `${t("extraSession")} ${e.start_time?.slice(0, 5)}–${e.end_time?.slice(0, 5)}`}
                  {e.reason ? ` · ${e.reason}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
