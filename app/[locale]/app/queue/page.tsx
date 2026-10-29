import { getTranslations } from "next-intl/server";
import { DayBoard } from "@/components/appointments/day-board";
import { enterRouteLocale } from "@/i18n/locale";
import { cairoToday } from "@/lib/time/dates";
import { getWorkspace } from "@/modules/tenancy/workspace";

/** Front desk: today's sessions for all doctors (check-in, queue, walk-ins). */
export default async function QueuePage({ params }: PageProps<"/[locale]/app/queue">) {
  enterRouteLocale((await params).locale);
  const t = await getTranslations("board");
  const workspace = await getWorkspace();
  const clinic = workspace?.active;
  if (!workspace || !clinic || !workspace.capabilities.includes("appointments.manage")) {
    return <p className="text-muted-foreground">{t("noAccess")}</p>;
  }
  return (
    <div className="grid max-w-5xl gap-4">
      <h1 className="text-2xl font-semibold">{t("queueTitle")}</h1>
      <DayBoard
        clinicId={clinic.clinicId}
        date={cairoToday()}
        mode="desk"
        isToday
        viewerIsOwner={clinic.role === "owner"}
        viewerDoctorId={workspace.doctorId}
        canMessage={workspace.capabilities.includes("messaging.send")}
      />
    </div>
  );
}
