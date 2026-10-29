// Scheduling fixtures inserted directly (as the table owner) so each test
// controls exact session times. Business functions are exercised by the tests.
import { randomUUID } from "node:crypto";
import { addMember, adminPool, createClinic, createUser, type ClinicRole } from "./helpers";

export type Policy = {
  method: "timed" | "queue";
  slot_minutes?: number | null;
  overbooking?: "disallow" | "receptionist_override" | "doctor_or_owner_approval";
  queue_ordering?: "fcfs" | "reservation_priority";
  walk_in?: "auto_append" | "receptionist_placement";
  absent_when_called?: "move_to_end" | "skip_and_prioritize" | "receptionist_assignment";
};

export type ClinicFixture = {
  clinicId: string;
  owner: string;
  receptionist: string;
  cashier: string;
  manager: string;
  doctorUser: string;
  doctorId: string;
  otherDoctorUser: string;
  otherDoctorId: string;
};

export async function addDoctor(clinicId: string, userId: string, name: string): Promise<string> {
  const { rows } = await adminPool().query<{ id: string }>(
    "insert into public.clinic_doctors (clinic_id, user_id, display_name) values ($1, $2, $3) returning id",
    [clinicId, userId, name],
  );
  return rows[0].id;
}

export async function setPolicy(clinicId: string, doctorId: string, updatedBy: string, policy: Policy): Promise<void> {
  await adminPool().query(
    `insert into public.doctor_scheduling_policies
       (clinic_doctor_id, clinic_id, method, slot_minutes, overbooking, queue_ordering, walk_in,
        absent_when_called, patient_cancellation, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'receptionist_only', $9)
     on conflict (clinic_doctor_id) do update set method = excluded.method, slot_minutes = excluded.slot_minutes,
       overbooking = excluded.overbooking, queue_ordering = excluded.queue_ordering, walk_in = excluded.walk_in,
       absent_when_called = excluded.absent_when_called`,
    [
      doctorId,
      clinicId,
      policy.method,
      policy.method === "timed" ? (policy.slot_minutes ?? 15) : null,
      policy.overbooking ?? "disallow",
      policy.queue_ordering ?? "fcfs",
      policy.walk_in ?? "auto_append",
      policy.absent_when_called ?? "move_to_end",
      updatedBy,
    ],
  );
}

export async function setupClinic(state: "active" | "pending" = "active"): Promise<ClinicFixture> {
  const clinicId = await createClinic(`Synthetic Scheduling ${randomUUID().slice(0, 6)}`, state);
  const users: Record<string, string> = {};
  const roles: [string, ClinicRole][] = [
    ["owner", "owner"],
    ["receptionist", "receptionist"],
    ["cashier", "cashier"],
    ["manager", "manager"],
    ["doctorUser", "doctor"],
    ["otherDoctorUser", "doctor"],
  ];
  for (const [key, role] of roles) {
    users[key] = await createUser(`m2-${key}`);
    await addMember(clinicId, users[key], role);
  }
  const doctorId = await addDoctor(clinicId, users.doctorUser, "Synthetic Dr. One");
  const otherDoctorId = await addDoctor(clinicId, users.otherDoctorUser, "Synthetic Dr. Two");
  return {
    clinicId,
    owner: users.owner,
    receptionist: users.receptionist,
    cashier: users.cashier,
    manager: users.manager,
    doctorUser: users.doctorUser,
    doctorId,
    otherDoctorUser: users.otherDoctorUser,
    otherDoctorId,
  };
}

/**
 * A session for the given doctor. Defaults: today in Cairo, started an hour
 * ago (so check-in, no-show and calling are allowed) and ending in 8 hours
 * (so booking is still open).
 */
export async function createSession(
  f: Pick<ClinicFixture, "clinicId">,
  doctorId: string,
  options: { method: "timed" | "queue"; capacity?: number; slotMinutes?: number; daysFromToday?: number },
): Promise<string> {
  const days = options.daysFromToday ?? 0;
  const { rows } = await adminPool().query<{ id: string }>(
    `insert into public.doctor_sessions (clinic_id, clinic_doctor_id, session_date, starts_at, ends_at, method, capacity, slot_minutes, source)
     values ($1, $2,
       (now() at time zone 'Africa/Cairo')::date + $3::int,
       date_trunc('hour', now()) - interval '1 hour' + make_interval(days => $3::int),
       date_trunc('hour', now()) + interval '8 hours' + make_interval(days => $3::int),
       $4, $5, $6, 'extra')
     returning id`,
    [
      f.clinicId,
      doctorId,
      days,
      options.method,
      options.method === "queue" ? (options.capacity ?? 2) : null,
      options.method === "timed" ? (options.slotMinutes ?? 15) : null,
    ],
  );
  return rows[0].id;
}

let chart = 1000;
export async function createPatient(clinicId: string, createdBy: string, name = "Synthetic Patient"): Promise<string> {
  const { rows: identity } = await adminPool().query<{ id: string }>(
    "insert into public.patient_identities (full_name, phone_e164, date_of_birth, gender) values ($1, '+201000000000', '1990-01-01', 'female') returning id",
    [name],
  );
  const { rows } = await adminPool().query<{ id: string }>(
    `insert into public.clinic_patients (clinic_id, patient_identity_id, chart_number, address, created_by)
     values ($1, $2, $3, 'Synthetic address', $4) returning id`,
    [clinicId, identity[0].id, ++chart, createdBy],
  );
  return rows[0].id;
}

export async function freeSlots(sessionId: string): Promise<string[]> {
  const { rows } = await adminPool().query<{ slot: Date }>("select private.session_free_slots($1) as slot", [
    sessionId,
  ]);
  return rows.map((r) => r.slot.toISOString());
}

export async function appointment(id: string) {
  const { rows } = await adminPool().query(
    "select status, reservation_number, waiting_number, queue_rank::float8 as queue_rank, is_overbooked, placement_open from public.appointments where id = $1",
    [id],
  );
  return rows[0];
}
