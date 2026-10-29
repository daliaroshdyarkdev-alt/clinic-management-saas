import { getTranslations } from "next-intl/server";
import { getAppointmentsForSessions, sortForQueue } from "@/modules/appointments/queries";
import { getConsultationStatuses } from "@/modules/clinical/queries";
import { getClinicDoctors, getSessionAvailability, getSessions } from "@/modules/scheduling/queries";
import { SessionBoard, type BoardMode } from "./session-board";

/** All sessions of one clinic day (optionally one doctor) with their appointments. */
export async function DayBoard({
  clinicId,
  date,
  doctorId,
  mode,
  isToday,
  viewerIsOwner,
  viewerDoctorId,
  canMessage = false,
}: {
  clinicId: string;
  date: string;
  doctorId?: string;
  mode: BoardMode;
  isToday: boolean;
  viewerIsOwner: boolean;
  viewerDoctorId: string | null;
  /** Viewer holds messaging.send (WAP-007); the SQL function re-checks. */
  canMessage?: boolean;
}) {
  const t = await getTranslations("board");
  const [doctors, sessions] = await Promise.all([
    getClinicDoctors(clinicId),
    getSessions(clinicId, date, date, doctorId),
  ]);
  const names = new Map(doctors.map((d) => [d.id, d.display_name]));
  const [appointments, availability] = await Promise.all([
    getAppointmentsForSessions(sessions.map((s) => s.id)),
    Promise.all(sessions.map((s) => (s.status === "scheduled" ? getSessionAvailability(s.id) : Promise.resolve(null)))),
  ]);

  const consultations = await getConsultationStatuses(appointments.map((a) => a.id));
  const activeDoctors = doctors.filter((d) => d.status === "active").map((d) => ({ id: d.id, name: d.display_name }));

  if (sessions.length === 0) return <p className="text-muted-foreground">{t("noSessions")}</p>;

  return (
    <div className="grid gap-4">
      {sessions.map((session, i) => (
        <SessionBoard
          key={session.id}
          session={session}
          doctorName={names.get(session.clinic_doctor_id) ?? ""}
          appointments={sortForQueue(appointments.filter((a) => a.session_id === session.id))}
          freeSlots={availability[i]?.free_slots ?? []}
          remaining={availability[i]?.remaining ?? null}
          mode={mode}
          isToday={isToday}
          canDecideOverbooking={viewerIsOwner || viewerDoctorId === session.clinic_doctor_id}
          consultations={consultations}
          doctors={activeDoctors}
          canMessage={canMessage}
        />
      ))}
    </div>
  );
}
