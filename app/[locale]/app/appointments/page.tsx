import { getFormatter, getTranslations } from "next-intl/server";
import { DayBoard } from "@/components/appointments/day-board";
import { Button } from "@/components/ui/button";
import { enterRouteLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { addDays, cairoToday, isDateKey } from "@/lib/time/dates";
import { getClinicDoctors } from "@/modules/scheduling/queries";
import { getWorkspace } from "@/modules/tenancy/workspace";

export default async function AppointmentsPage({ params, searchParams }: PageProps<"/[locale]/app/appointments">) {
  enterRouteLocale((await params).locale);
  const t = await getTranslations("board");
  const format = await getFormatter();
  const workspace = await getWorkspace();
  const clinic = workspace?.active;
  if (!workspace || !clinic || !workspace.capabilities.includes("appointments.manage")) {
    return <p className="text-muted-foreground">{t("noAccess")}</p>;
  }

  const query = await searchParams;
  const today = cairoToday();
  const date = isDateKey(query.date) ? query.date : today;
  const doctors = await getClinicDoctors(clinic.clinicId);
  const doctorId = doctors.find((d) => d.id === query.doctor)?.id;
  const link = (d: string) => ({
    pathname: "/app/appointments" as const,
    query: { date: d, ...(doctorId ? { doctor: doctorId } : {}) },
  });

  return (
    <div className="grid max-w-5xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {t("appointmentsTitle")} ·{" "}
          {format.dateTime(new Date(`${date}T12:00:00Z`), { dateStyle: "full", timeZone: "UTC" })}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={link(addDays(date, -1))}>{t("previousDay")}</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={link(today)}>{t("today")}</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={link(addDays(date, 1))}>{t("nextDay")}</Link>
          </Button>
        </div>
      </div>
      <form className="flex flex-wrap items-end gap-2 text-sm">
        <input type="hidden" name="date" value={date} />
        <label className="grid gap-1">
          {t("doctor")}
          <select
            name="doctor"
            defaultValue={doctorId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-2"
          >
            <option value="">{t("allDoctors")}</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.display_name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline" size="sm">
          {t("filter")}
        </Button>
      </form>
      <DayBoard
        clinicId={clinic.clinicId}
        date={date}
        doctorId={doctorId}
        mode="desk"
        isToday={date === today}
        viewerIsOwner={clinic.role === "owner"}
        viewerDoctorId={workspace.doctorId}
        canMessage={workspace.capabilities.includes("messaging.send")}
      />
    </div>
  );
}
