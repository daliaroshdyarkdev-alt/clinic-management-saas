// Doctors, scheduling policies, weekly schedules, exceptions and sessions.
// SRS APT-004, APT-005, APT-012, ONB-004.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminPool, asUser, asUserCommitted, closePool, expectPgError } from "./helpers";
import { createPatient, createSession, setPolicy, setupClinic, type ClinicFixture } from "./fixtures";

afterAll(closePool);

let f: ClinicFixture;
beforeEach(async () => {
  f = await setupClinic();
});

const policyArgs = (doctorId: string, method = "timed", slot: number | null = 20) => [
  doctorId,
  method,
  slot,
  "disallow",
  "fcfs",
  "auto_append",
  "move_to_end",
  "receptionist_only",
];
const SET_POLICY = "select public.set_scheduling_policy($1, $2, $3, $4, $5, $6, $7, $8)";

async function sessions(doctorId: string) {
  const { rows } = await adminPool().query<{ session_date: string; starts_at: Date; ends_at: Date; status: string }>(
    "select to_char(session_date, 'YYYY-MM-DD') as session_date, starts_at, ends_at, status from public.doctor_sessions where clinic_doctor_id = $1 order by starts_at",
    [doctorId],
  );
  return rows;
}

describe("doctors", () => {
  it("only the owner adds a doctor, and only from an active doctor or owner membership", async () => {
    const { rows } = await adminPool().query<{ id: string }>(
      "select id from public.clinic_memberships where clinic_id = $1 and user_id = $2",
      [f.clinicId, f.owner],
    );
    await asUser(f.receptionist, (db) =>
      expectPgError(db.query("select public.add_clinic_doctor($1, 'Dr X', null)", [rows[0].id]), /forbidden/),
    );
    // Owner-doctor (OD-E02).
    const id = await asUserCommitted(
      f.owner,
      async (db) =>
        (
          await db.query("select public.add_clinic_doctor($1, 'Synthetic Owner Doctor', 'Pediatrics') as id", [
            rows[0].id,
          ])
        ).rows[0].id,
    );
    expect(id).toBeTruthy();

    const { rows: cashier } = await adminPool().query<{ id: string }>(
      "select id from public.clinic_memberships where clinic_id = $1 and user_id = $2",
      [f.clinicId, f.cashier],
    );
    await asUser(f.owner, (db) =>
      expectPgError(
        db.query("select public.add_clinic_doctor($1, 'Dr Cashier', null)", [cashier[0].id]),
        /not_a_doctor_member/,
      ),
    );
  });
});

describe("scheduling policy (APT-004)", () => {
  it("the doctor sets their own policy; the owner may too; reception and other doctors may not", async () => {
    await asUserCommitted(f.doctorUser, (db) => db.query(SET_POLICY, policyArgs(f.doctorId)));
    await asUserCommitted(f.owner, (db) => db.query(SET_POLICY, policyArgs(f.doctorId, "queue", null)));
    await asUser(f.receptionist, (db) => expectPgError(db.query(SET_POLICY, policyArgs(f.doctorId)), /forbidden/));
    await asUser(f.otherDoctorUser, (db) => expectPgError(db.query(SET_POLICY, policyArgs(f.doctorId)), /forbidden/));
  });

  it("timed booking requires a slot length", async () => {
    await asUser(f.doctorUser, (db) =>
      expectPgError(db.query(SET_POLICY, policyArgs(f.doctorId, "timed", null)), /invalid_value/),
    );
  });

  it("no sessions are generated before a booking method is chosen", async () => {
    await asUserCommitted(f.doctorUser, (db) =>
      db.query(`select public.set_weekly_schedule($1, '[{"weekday":1,"start":"09:00","end":"12:00"}]')`, [f.doctorId]),
    );
    await asUserCommitted(f.receptionist, (db) =>
      db.query("select public.ensure_sessions($1, '2027-01-03', '2027-01-16')", [f.clinicId]),
    );
    expect(await sessions(f.doctorId)).toEqual([]);
  });
});

describe("weekly schedule and sessions (APT-005)", () => {
  beforeEach(async () => {
    await asUserCommitted(f.doctorUser, (db) => db.query(SET_POLICY, policyArgs(f.doctorId)));
    // Mondays 09:00-12:00 Cairo time.
    await asUserCommitted(f.doctorUser, (db) =>
      db.query(`select public.set_weekly_schedule($1, '[{"weekday":1,"start":"09:00","end":"12:00"}]')`, [f.doctorId]),
    );
  });

  it("materialises Monday sessions in Cairo time, across Egyptian daylight saving time", async () => {
    await asUserCommitted(f.receptionist, (db) =>
      db.query("select public.ensure_sessions($1, '2027-01-03', '2027-01-16')", [f.clinicId]),
    );
    await asUserCommitted(f.receptionist, (db) =>
      db.query("select public.ensure_sessions($1, '2027-07-04', '2027-07-10')", [f.clinicId]),
    );
    const rows = await sessions(f.doctorId);
    expect(rows.map((r) => [r.session_date, r.starts_at.toISOString(), r.ends_at.toISOString()])).toEqual([
      ["2027-01-04", "2027-01-04T07:00:00.000Z", "2027-01-04T10:00:00.000Z"], // winter, UTC+2
      ["2027-01-11", "2027-01-11T07:00:00.000Z", "2027-01-11T10:00:00.000Z"],
      ["2027-07-05", "2027-07-05T06:00:00.000Z", "2027-07-05T09:00:00.000Z"], // summer DST, UTC+3
    ]);
  });

  it("is idempotent", async () => {
    for (let i = 0; i < 2; i++) {
      await asUserCommitted(f.receptionist, (db) =>
        db.query("select public.ensure_sessions($1, '2027-01-03', '2027-01-16')", [f.clinicId]),
      );
    }
    expect((await sessions(f.doctorId)).length).toBe(2);
  });

  it("rejects overlapping weekly blocks", async () => {
    await asUser(f.doctorUser, (db) =>
      expectPgError(
        db.query(
          `select public.set_weekly_schedule($1, '[{"weekday":1,"start":"09:00","end":"12:00"},{"weekday":1,"start":"11:00","end":"13:00"}]')`,
          [f.doctorId],
        ),
        /session_overlap/,
      ),
    );
  });

  it("a day off removes that day's session; an overlapping extra session is rejected", async () => {
    await asUserCommitted(f.doctorUser, (db) =>
      db.query(
        "select public.add_schedule_exception($1, '2027-01-11', 'day_off', null, null, null, 'Synthetic leave')",
        [f.doctorId],
      ),
    );
    await asUserCommitted(f.receptionist, (db) =>
      db.query("select public.ensure_sessions($1, '2027-01-03', '2027-01-16')", [f.clinicId]),
    );
    expect((await sessions(f.doctorId)).map((r) => r.session_date)).toEqual(["2027-01-04"]);

    await asUser(f.doctorUser, (db) =>
      expectPgError(
        db.query(
          "select public.add_schedule_exception($1, '2027-01-04', 'extra_session', '11:00', '14:00', null, null)",
          [f.doctorId],
        ),
        /session_overlap/,
      ),
    );
    await asUserCommitted(f.doctorUser, (db) =>
      db.query(
        "select public.add_schedule_exception($1, '2027-01-04', 'extra_session', '17:00', '19:00', null, null)",
        [f.doctorId],
      ),
    );
    expect((await sessions(f.doctorId)).map((r) => r.starts_at.toISOString())).toContain("2027-01-04T15:00:00.000Z");
  });

  it("changing the schedule regenerates unused future sessions but keeps booked ones", async () => {
    await asUserCommitted(f.receptionist, (db) =>
      db.query("select public.ensure_sessions($1, '2027-01-03', '2027-01-16')", [f.clinicId]),
    );
    const { rows } = await adminPool().query<{ id: string }>(
      "select id from public.doctor_sessions where clinic_doctor_id = $1 and session_date = '2027-01-04'",
      [f.doctorId],
    );
    const patient = await createPatient(f.clinicId, f.receptionist);
    await asUserCommitted(f.receptionist, (db) =>
      db.query("select public.book_appointment($1, $2, '2027-01-04T07:00:00Z', false, null)", [rows[0].id, patient]),
    );
    await asUserCommitted(f.doctorUser, (db) =>
      db.query(`select public.set_weekly_schedule($1, '[{"weekday":2,"start":"09:00","end":"12:00"}]')`, [f.doctorId]),
    );
    await asUserCommitted(f.receptionist, (db) =>
      db.query("select public.ensure_sessions($1, '2027-01-03', '2027-01-16')", [f.clinicId]),
    );
    expect((await sessions(f.doctorId)).map((r) => r.session_date)).toEqual(["2027-01-04", "2027-01-05", "2027-01-12"]);
  });

  it("members of another clinic cannot see or generate this clinic's sessions", async () => {
    const other = await setupClinic();
    await asUser(other.receptionist, (db) =>
      expectPgError(
        db.query("select public.ensure_sessions($1, '2027-01-03', '2027-01-16')", [f.clinicId]),
        /forbidden/,
      ),
    );
    await createSession(f, f.doctorId, { method: "queue" });
    const visible = await asUser(
      other.owner,
      async (db) =>
        (await db.query("select id from public.doctor_sessions where clinic_id = $1", [f.clinicId])).rowCount,
    );
    expect(visible).toBe(0);
  });
});

describe("session cancellation (APT-012)", () => {
  it("cancels the session, keeps its appointments for reception and blocks new bookings", async () => {
    await setPolicy(f.clinicId, f.doctorId, f.owner, { method: "queue" });
    const session = await createSession(f, f.doctorId, { method: "queue", capacity: 5 });
    const patient = await createPatient(f.clinicId, f.receptionist);
    await asUserCommitted(f.receptionist, (db) =>
      db.query("select public.book_appointment($1, $2, null, false, null)", [session, patient]),
    );

    await asUser(f.doctorUser, (db) =>
      expectPgError(db.query("select public.cancel_doctor_session($1, '')", [session]), /reason_required/),
    );
    const affected = await asUserCommitted(
      f.doctorUser,
      async (db) =>
        (await db.query("select public.cancel_doctor_session($1, 'Synthetic emergency') as n", [session])).rows[0].n,
    );
    expect(affected).toBe(1);

    const other = await createPatient(f.clinicId, f.receptionist);
    await asUser(f.receptionist, (db) =>
      expectPgError(
        db.query("select public.book_appointment($1, $2, null, false, null)", [session, other]),
        /session_cancelled/,
      ),
    );
    await asUser(f.otherDoctorUser, (db) =>
      expectPgError(db.query("select public.cancel_doctor_session($1, 'x')", [session]), /forbidden|session_cancelled/),
    );
  });
});

describe("operational gate (ONB-004)", () => {
  it("a pending clinic cannot register patients or book", async () => {
    const pending = await setupClinic("pending");
    await setPolicy(pending.clinicId, pending.doctorId, pending.owner, { method: "queue" });
    const session = await createSession(pending, pending.doctorId, { method: "queue" });
    const patient = await createPatient(pending.clinicId, pending.receptionist);
    await asUser(pending.receptionist, (db) =>
      expectPgError(
        db.query(
          "select public.register_clinic_patient($1, 'Synthetic P', '+201000000001', '1990-01-01', 'male', 'Addr', null, 'ar')",
          [pending.clinicId],
        ),
        /clinic_not_operational/,
      ),
    );
    await asUser(pending.receptionist, (db) =>
      expectPgError(
        db.query("select public.book_appointment($1, $2, null, false, null)", [session, patient]),
        /clinic_not_operational/,
      ),
    );
  });
});
