import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  appointmentTransition,
  bookAppointment,
  callNextPatient,
  cancelOrNoShow,
  decideOverbooking,
  placeInQueue,
  registerWalkIn,
} from "@/modules/appointments/actions";
import type { AppointmentRow } from "@/modules/appointments/queries";
import { openConsultation, reassignConsultation } from "@/modules/clinical/actions";
import { cancelSession } from "@/modules/scheduling/actions";
import type { DoctorSession } from "@/modules/scheduling/queries";

export type BoardMode = "desk" | "doctor";

/**
 * One doctor session with its appointments and the actions the viewer may
 * take. Buttons mirror the SQL rules; the SQL functions remain the authority.
 */
export async function SessionBoard({
  session,
  doctorName,
  appointments,
  freeSlots,
  remaining,
  mode,
  isToday,
  canDecideOverbooking,
  consultations,
  doctors,
}: {
  session: DoctorSession;
  doctorName: string;
  appointments: AppointmentRow[];
  freeSlots: string[];
  remaining: number | null;
  mode: BoardMode;
  isToday: boolean;
  canDecideOverbooking: boolean;
  /** Consultation per appointment id (status only, no content). */
  consultations: Map<string, { consultationId: string; status: "draft" | "completed" }>;
  /** Active doctors of the clinic, for reassigning an open consultation. */
  doctors: { id: string; name: string }[];
}) {
  const t = await getTranslations("board");
  const format = await getFormatter();
  const time = (iso: string) => format.dateTime(new Date(iso), { timeStyle: "short" });
  const cancelled = session.status === "cancelled";
  const open = !cancelled && new Date(session.ends_at) > new Date();
  const waiting = appointments.filter((a) => a.status === "checked_in");
  const desk = mode === "desk";

  return (
    <Card className={cancelled ? "opacity-70" : undefined}>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base">
            {doctorName} · {time(session.starts_at)}–{time(session.ends_at)}
          </h2>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t(`method.${session.method}`)}
          {session.method === "queue"
            ? ` · ${t("remaining", { n: remaining ?? 0, capacity: session.capacity ?? 0 })}`
            : ""}
          {session.method === "timed" && open ? ` · ${t("freeSlots", { n: freeSlots.length })}` : ""}
          {cancelled ? ` · ${t("cancelled")}${session.cancelled_reason ? `: ${session.cancelled_reason}` : ""}` : ""}
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        {isToday && !cancelled && waiting.length > 0 ? (
          <ActionForm action={callNextPatient}>
            <input type="hidden" name="sessionId" value={session.id} />
            <div>
              <SubmitButton size="sm">{t("callNext", { n: waiting.length })}</SubmitButton>
            </div>
          </ActionForm>
        ) : null}

        {appointments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ol className="divide-y rounded-md border">
            {appointments.map((a) => (
              <li key={a.id} className="grid gap-2 p-3 text-sm md:grid-cols-[1fr_auto]">
                <div>
                  <p className="font-medium">
                    {a.patient.identity.full_name}{" "}
                    <span className="text-muted-foreground">#{a.patient.chart_number}</span>
                  </p>
                  <p className="text-muted-foreground">
                    {a.method === "timed" && a.starts_at ? `${time(a.starts_at)} · ` : ""}
                    {a.reservation_number ? `${t("reservation", { n: a.reservation_number })} · ` : ""}
                    {a.waiting_number ? `${t("waiting", { n: a.waiting_number })} · ` : ""}
                    <span className="font-medium text-foreground">{t(`status.${a.status}`)}</span>
                    {a.is_overbooked ? ` · ${t("overbooked")}` : ""}
                    {a.source !== "reception" ? ` · ${t(`source.${a.source}`)}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {!desk && ["checked_in", "called", "completed"].includes(a.status) ? (
                    <ActionForm action={openConsultation}>
                      <input type="hidden" name="appointmentId" value={a.id} />
                      <SubmitButton size="sm" variant={consultations.has(a.id) ? "outline" : "default"}>
                        {consultations.get(a.id)?.status === "completed"
                          ? t("viewConsultation")
                          : consultations.has(a.id)
                            ? t("continueConsultation")
                            : t("startConsultation")}
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                  {desk && consultations.get(a.id)?.status === "draft" ? (
                    <ActionForm action={reassignConsultation} className="flex items-center gap-2">
                      <input type="hidden" name="consultationId" value={consultations.get(a.id)!.consultationId} />
                      <select name="clinicDoctorId" className="h-8 rounded-md border border-input bg-background px-2">
                        {doctors
                          .filter((d) => d.id !== a.clinic_doctor_id)
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                      </select>
                      <SubmitButton size="sm" variant="outline">
                        {t("reassign")}
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                  {a.status === "awaiting_approval" && canDecideOverbooking ? (
                    <>
                      <ActionForm action={decideOverbooking}>
                        <input type="hidden" name="appointmentId" value={a.id} />
                        <input type="hidden" name="approve" value="true" />
                        <SubmitButton size="sm">{t("approveOverbooking")}</SubmitButton>
                      </ActionForm>
                      <ActionForm action={decideOverbooking}>
                        <input type="hidden" name="appointmentId" value={a.id} />
                        <input type="hidden" name="approve" value="false" />
                        <SubmitButton size="sm" variant="outline">
                          {t("rejectOverbooking")}
                        </SubmitButton>
                      </ActionForm>
                    </>
                  ) : null}
                  {desk && a.status === "booked" && isToday && !cancelled ? (
                    <Transition id={a.id} action="check_in" label={t("checkIn")} />
                  ) : null}
                  {a.status === "called" ? (
                    <>
                      <Transition id={a.id} action="complete" label={t("complete")} />
                      <Transition id={a.id} action="absent" label={t("absent")} variant="outline" />
                    </>
                  ) : null}
                  {desk && a.status === "absent" ? (
                    <Transition id={a.id} action="return" label={t("returned")} />
                  ) : null}
                  {desk && a.status === "checked_in" && a.placement_open ? (
                    <ActionForm action={placeInQueue} className="flex items-center gap-2">
                      <input type="hidden" name="appointmentId" value={a.id} />
                      <select name="beforeId" className="h-8 rounded-md border border-input bg-background px-2">
                        <option value="">{t("placeAtEnd")}</option>
                        {waiting
                          .filter((w) => w.id !== a.id)
                          .map((w) => (
                            <option key={w.id} value={w.id}>
                              {t("placeBefore", { name: w.patient.identity.full_name })}
                            </option>
                          ))}
                      </select>
                      <SubmitButton size="sm" variant="outline">
                        {t("place")}
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                  {desk && ["awaiting_approval", "booked", "checked_in", "absent"].includes(a.status) ? (
                    <details className="w-full md:w-64">
                      <summary className="cursor-pointer text-muted-foreground">{t("more")}</summary>
                      <ActionForm action={cancelOrNoShow} className="mt-2">
                        <input type="hidden" name="appointmentId" value={a.id} />
                        <Input name="reason" placeholder={t("reason")} maxLength={500} />
                        <div className="flex flex-wrap gap-2">
                          <SubmitButton size="sm" variant="outline" name="kind" value="cancel">
                            {t("cancel")}
                          </SubmitButton>
                          {["booked", "absent"].includes(a.status) ? (
                            <SubmitButton size="sm" variant="outline" name="kind" value="no_show">
                              {t("noShow")}
                            </SubmitButton>
                          ) : null}
                        </div>
                      </ActionForm>
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}

        {desk && open ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-primary">{t("book")}</summary>
            <ActionForm action={bookAppointment} className="mt-3 sm:grid-cols-3 sm:items-end">
              <input type="hidden" name="sessionId" value={session.id} />
              <label className="grid gap-1">
                {t("chartNumber")}
                <Input name="chartNumber" type="number" min={1} required />
              </label>
              {session.method === "timed" ? (
                <label className="grid gap-1">
                  {t("slot")}
                  <select name="startsAt" required className="h-9 rounded-md border border-input bg-background px-2">
                    {freeSlots.map((s) => (
                      <option key={s} value={s}>
                        {time(s)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <OverbookFields label={t("overbook")} reason={t("overbookReason")} />
              <div>
                <SubmitButton size="sm">{t("bookSubmit")}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        ) : null}

        {desk && open && isToday && session.method === "queue" ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-primary">{t("walkIn")}</summary>
            <ActionForm action={registerWalkIn} className="mt-3 sm:grid-cols-3 sm:items-end">
              <input type="hidden" name="sessionId" value={session.id} />
              <label className="grid gap-1">
                {t("chartNumber")}
                <Input name="chartNumber" type="number" min={1} required />
              </label>
              <OverbookFields label={t("overbook")} reason={t("overbookReason")} />
              <div>
                <SubmitButton size="sm">{t("walkInSubmit")}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        ) : null}

        {desk && !cancelled ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-destructive">{t("cancelSession")}</summary>
            <ActionForm action={cancelSession} className="mt-3">
              <input type="hidden" name="sessionId" value={session.id} />
              <Input name="reason" placeholder={t("reason")} required maxLength={500} />
              <p className="text-xs text-muted-foreground">{t("cancelSessionHint")}</p>
              <div>
                <SubmitButton size="sm" variant="outline">
                  {t("cancelSessionSubmit")}
                </SubmitButton>
              </div>
            </ActionForm>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Transition({
  id,
  action,
  label,
  variant,
}: {
  id: string;
  action: "check_in" | "complete" | "absent" | "return";
  label: string;
  variant?: "outline";
}) {
  return (
    <ActionForm action={appointmentTransition}>
      <input type="hidden" name="appointmentId" value={id} />
      <input type="hidden" name="action" value={action} />
      <SubmitButton size="sm" variant={variant}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

function OverbookFields({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="grid gap-1">
      <label className="flex items-center gap-2">
        <input type="checkbox" name="overbook" className="size-4" />
        {label}
      </label>
      <Input name="reason" placeholder={reason} maxLength={500} />
    </div>
  );
}
