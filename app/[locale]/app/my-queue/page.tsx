import { getTranslations } from "next-intl/server";
import { DayBoard } from "@/components/appointments/day-board";
import { enterRouteLocale } from "@/i18n/locale";
import { cairoToday } from "@/lib/time/dates";
import { getWorkspace } from "@/modules/tenancy/workspace";

/** Doctor view: own sessions today; call next, complete, absent, decide overbooking. */
export default async function MyQueuePage({ params }: PageProps<"/[locale]/app/my-queue">) {
  enterRouteLocale((await params).locale);
  const t = await getTranslations("board");
  const workspace = await getWorkspace();
  const clinic = workspace?.active;
  if (!workspace || !clinic || !workspace.doctorId) return <p className="text-muted-foreground">{t("noAccess")}</p>;
  return (
    <div className="grid max-w-5xl gap-4">
      <h1 className="text-2xl font-semibold">{t("myQueueTitle")}</h1>
      <DayBoard
        clinicId={clinic.clinicId}
        date={cairoToday()}
        doctorId={workspace.doctorId}
        mode="doctor"
        isToday
        viewerIsOwner={clinic.role === "owner"}
        viewerDoctorId={workspace.doctorId}
      />
    </div>
  );
}
