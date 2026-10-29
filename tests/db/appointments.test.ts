// Patients, booking, overbooking, check-in, queue order, absence, walk-ins,
// no-shows and visibility. SRS PAT-001 (minimal), APT-001, APT-006..011,
// APT-014..016, STA-006.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminPool, asUser, asUserCommitted, closePool, expectPgError } from "./helpers";
import {
  appointment,
  createPatient,
  createSession,
  freeSlots,
  setPolicy,
  setupClinic,
  type ClinicFixture,
  type Policy,
} from "./fixtures";

afterAll(closePool);

let f: ClinicFixture;
beforeEach(async () => {
  f = await setupClinic();
});

const book = (
  user: string,
  session: string,
  patient: string,
  startsAt: string | null = null,
  overbook = false,
  reason: string | null = null,
) =>
  asUserCommitted(
    user,
    async (db) =>
      (
        await db.query<{ id: string }>("select public.book_appointment($1, $2, $3, $4, $5) as id", [
          session,
          patient,
          startsAt,
          overbook,
          reason,
        ])
      ).rows[0].id,
  );

const call = (user: string, fn: string, ...args: unknown[]) =>
  asUserCommitted(user, async (db) => {
    const params = args.map((_, i) => `$${i + 1}`).join(", ");
    return (await db.query(`select public.${fn}(${params}) as result`, args)).rows[0].result;
  });

async function queueSession(policy: Partial<Policy> = {}, capacity = 3) {
  await setPolicy(f.clinicId, f.doctorId, f.owner, { method: "queue", ...policy });
  return createSession(f, f.doctorId, { method: "queue", capacity });
}

async function timedSession(policy: Partial<Policy> = {}) {
  await setPolicy(f.clinicId, f.doctorId, f.owner, { method: "timed", slot_minutes: 15, ...policy });
  return createSession(f, f.doctorId, { method: "timed", slotMinutes: 15 });
}

describe("patient registration (PAT-001, minimal)", () => {
  const REGISTER = "select public.register_clinic_patient($1, $2, $3, $4, $5, $6, $7, $8) as id";
  const valid = (clinicId: string) => [
    clinicId,
    "Synthetic Patient",
    "+201000000002",
    "1985-05-05",
    "female",
    "Synthetic Street 1",
    null,
    "ar",
  ];

  it("reception registers patients with sequential chart numbers", async () => {
    const a = await asUserCommitted(
      f.receptionist,
      async (db) => (await db.query(REGISTER, valid(f.clinicId))).rows[0].id,
    );
    const b = await asUserCommitted(
      f.receptionist,
      async (db) => (await db.query(REGISTER, valid(f.clinicId))).rows[0].id,
    );
    const { rows } = await adminPool().query(
      "select chart_number from public.clinic_patients where id = any($1) order by chart_number",
      [[a, b]],
    );
    expect(rows.map((r) => r.chart_number)).toEqual([1, 2]);
  });

  it("validates input", async () => {
    const badPhone = valid(f.clinicId);
    badPhone[2] = "01000000000";
    await asUser(f.receptionist, (db) => expectPgError(db.query(REGISTER, badPhone), /invalid_patient/));
    const future = valid(f.clinicId);
    future[3] = "2999-01-01";
    await asUser(f.receptionist, (db) => expectPgError(db.query(REGISTER, future), /invalid_patient/));
  });

  it("doctors and cashiers cannot register patients; other clinics cannot either", async () => {
    await asUser(f.doctorUser, (db) => expectPgError(db.query(REGISTER, valid(f.clinicId)), /forbidden/));
    await asUser(f.cashier, (db) => expectPgError(db.query(REGISTER, valid(f.clinicId)), /forbidden/));
    const other = await setupClinic();
    await asUser(other.receptionist, (db) => expectPgError(db.query(REGISTER, valid(f.clinicId)), /forbidden/));
  });
});

describe("queue booking", () => {
  it("assigns sequential reservation numbers and enforces capacity", async () => {
    const session = await queueSession({}, 2);
    const p = await Promise.all([1, 2, 3].map(() => createPatient(f.clinicId, f.receptionist)));
    const a1 = await book(f.receptionist, session, p[0]);
    const a2 = await book(f.receptionist, session, p[1]);
    expect([(await appointment(a1)).reservation_number, (await appointment(a2)).reservation_number]).toEqual([1, 2]);
    await asUser(f.receptionist, (db) =>
      expectPgError(
        db.query("select public.book_appointment($1, $2, null, false, null)", [session, p[2]]),
        /session_full/,
      ),
    );
  });

  it("a cancellation frees the place", async () => {
    const session = await queueSession({}, 1);
    const [p1, p2] = [await createPatient(f.clinicId, f.receptionist), await createPatient(f.clinicId, f.receptionist)];
    const a1 = await book(f.receptionist, session, p1);
    await asUser(f.receptionist, (db) =>
      expectPgError(db.query("select public.cancel_appointment($1, '')", [a1]), /reason_required/),
    );
    await call(f.receptionist, "cancel_appointment", a1, "Synthetic: patient called");
    await book(f.receptionist, session, p2);
  });

  it("the same patient cannot hold two places in one session", async () => {
    const session = await queueSession();
    const patient = await createPatient(f.clinicId, f.receptionist);
    await book(f.receptionist, session, patient);
    await asUser(f.receptionist, (db) =>
      expectPgError(
        db.query("select public.book_appointment($1, $2, null, false, null)", [session, patient]),
        /already_booked/,
      ),
    );
  });

  it("a patient from another clinic cannot be booked (forged id)", async () => {
    const session = await queueSession();
    const other = await setupClinic();
    const foreignPatient = await createPatient(other.clinicId, other.receptionist);
    await asUser(f.receptionist, (db) =>
      expectPgError(
        db.query("select public.book_appointment($1, $2, null, false, null)", [session, foreignPatient]),
        /patient_not_found/,
      ),
    );
  });
});

describe("timed booking", () => {
  it("books aligned free slots only", async () => {
    const session = await timedSession();
    const slots = await freeSlots(session);
    const p1 = await createPatient(f.clinicId, f.receptionist);
    const p2 = await createPatient(f.clinicId, f.receptionist);
    await book(f.receptionist, session, p1, slots[0]);
    expect(await freeSlots(session)).not.toContain(slots[0]);
    await asUser(f.receptionist, (db) =>
      expectPgError(
        db.query("select public.book_appointment($1, $2, $3, false, null)", [session, p2, slots[0]]),
        /slot_taken/,
      ),
    );
    const misaligned = new Date(new Date(slots[1]).getTime() + 5 * 60_000).toISOString();
    await asUser(f.receptionist, (db) =>
      expectPgError(
        db.query("select public.book_appointment($1, $2, $3, false, null)", [session, p2, misaligned]),
        /invalid_slot/,
      ),
    );
  });
});

describe("overbooking (APT-011)", () => {
  async function fullQueue(policy: Policy["overbooking"]) {
    const session = await queueSession({ overbooking: policy }, 1);
    await book(f.receptionist, session, await createPatient(f.clinicId, f.receptionist));
    return { session, patient: await createPatient(f.clinicId, f.receptionist) };
  }

  it("disallow: reception cannot override", async () => {
    const { session, patient } = await fullQueue("disallow");
    await asUser(f.receptionist, (db) =>
      expectPgError(
        db.query("select public.book_appointment($1, $2, null, true, 'urgent')", [session, patient]),
        /overbooking_not_allowed/,
      ),
    );
  });

  it("receptionist_override: allowed with a reason, flagged as overbooked", async () => {
    const { session, patient } = await fullQueue("receptionist_override");
    await asUser(f.receptionist, (db) =>
      expectPgError(
        db.query("select public.book_appointment($1, $2, null, true, '')", [session, patient]),
        /reason_required/,
      ),
    );
    const id = await book(f.receptionist, session, patient, null, true, "Synthetic urgent case");
    expect(await appointment(id)).toMatchObject({ status: "booked", is_overbooked: true });
  });

  it("doctor_or_owner_approval: waits for the doctor; reception cannot approve", async () => {
    const { session, patient } = await fullQueue("doctor_or_owner_approval");
    const id = await book(f.receptionist, session, patient, null, true, "Synthetic urgent case");
    expect((await appointment(id)).status).toBe("awaiting_approval");
    await asUser(f.receptionist, (db) =>
      expectPgError(db.query("select public.decide_overbooking($1, true, null)", [id]), /forbidden/),
    );
    await asUser(f.otherDoctorUser, (db) =>
      expectPgError(db.query("select public.decide_overbooking($1, true, null)", [id]), /forbidden/),
    );
    await call(f.doctorUser, "decide_overbooking", id, true, null);
    expect((await appointment(id)).status).toBe("booked");
  });
});

describe("check-in and queue (APT-006, APT-007)", () => {
  async function bookThree(policy: Partial<Policy>) {
    const session = await queueSession(policy, 5);
    const ids = [];
    for (let i = 0; i < 3; i++)
      ids.push(await book(f.receptionist, session, await createPatient(f.clinicId, f.receptionist)));
    return { session, ids };
  }

  it("waiting numbers are assigned at check-in, separately from reservation numbers", async () => {
    const { ids } = await bookThree({});
    // Patients arrive in reverse order of booking.
    for (const id of [...ids].reverse()) await call(f.receptionist, "check_in_appointment", id);
    const rows = await Promise.all(ids.map(appointment));
    expect(rows.map((r) => [r.reservation_number, r.waiting_number])).toEqual([
      [1, 3],
      [2, 2],
      [3, 1],
    ]);
  });

  it("FCFS calls by arrival; reservation priority calls by reservation number", async () => {
    for (const ordering of ["fcfs", "reservation_priority"] as const) {
      f = await setupClinic();
      const { session, ids } = await bookThree({ queue_ordering: ordering });
      for (const id of [...ids].reverse()) await call(f.receptionist, "check_in_appointment", id);
      const first = await call(f.doctorUser, "call_next_patient", session);
      expect(first).toBe(ordering === "fcfs" ? ids[2] : ids[0]);
    }
  });

  it("only the session's doctor or reception can call; another doctor cannot", async () => {
    const { session, ids } = await bookThree({});
    await call(f.receptionist, "check_in_appointment", ids[0]);
    await asUser(f.otherDoctorUser, (db) =>
      expectPgError(db.query("select public.call_next_patient($1)", [session]), /forbidden/),
    );
    await asUser(f.cashier, (db) =>
      expectPgError(db.query("select public.call_next_patient($1)", [session]), /forbidden/),
    );
  });

  it("check-in only on the session day", async () => {
    await setPolicy(f.clinicId, f.doctorId, f.owner, { method: "queue" });
    const tomorrow = await createSession(f, f.doctorId, { method: "queue", daysFromToday: 1 });
    const id = await book(f.receptionist, tomorrow, await createPatient(f.clinicId, f.receptionist));
    await asUser(f.receptionist, (db) =>
      expectPgError(db.query("select public.check_in_appointment($1)", [id]), /not_session_day/),
    );
  });
});

describe("absent when called (APT-010)", () => {
  async function scenario(absent: Policy["absent_when_called"]) {
    f = await setupClinic();
    const session = await queueSession({ absent_when_called: absent }, 5);
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const id = await book(f.receptionist, session, await createPatient(f.clinicId, f.receptionist));
      await call(f.receptionist, "check_in_appointment", id);
      ids.push(id);
    }
    const called = await call(f.doctorUser, "call_next_patient", session);
    expect(called).toBe(ids[0]);
    await call(f.doctorUser, "mark_absent", ids[0]);
    await call(f.receptionist, "return_from_absence", ids[0]);
    return { session, ids };
  }

  it("move_to_end: the returning patient goes after everyone waiting", async () => {
    const { session, ids } = await scenario("move_to_end");
    expect(await call(f.doctorUser, "call_next_patient", session)).toBe(ids[1]);
  });

  it("skip_and_prioritize: the returning patient is called next", async () => {
    const { session, ids } = await scenario("skip_and_prioritize");
    expect(await call(f.doctorUser, "call_next_patient", session)).toBe(ids[0]);
  });

  it("receptionist_assignment: reception chooses the position", async () => {
    const { session, ids } = await scenario("receptionist_assignment");
    expect((await appointment(ids[0])).placement_open).toBe(true);
    await call(f.receptionist, "place_in_queue", ids[0], ids[2]);
    expect(await call(f.doctorUser, "call_next_patient", session)).toBe(ids[1]);
    expect(await call(f.doctorUser, "call_next_patient", session)).toBe(ids[0]);
  });

  it("placement is refused when the policy does not give reception that choice", async () => {
    const { ids } = await scenario("move_to_end");
    await asUser(f.receptionist, (db) =>
      expectPgError(db.query("select public.place_in_queue($1, null)", [ids[0]]), /placement_not_allowed/),
    );
  });
});

describe("walk-ins (APT-009) and completion", () => {
  it("auto_append: walk-in is checked in at the end of the queue", async () => {
    const session = await queueSession({ walk_in: "auto_append" }, 5);
    const booked = await book(f.receptionist, session, await createPatient(f.clinicId, f.receptionist));
    await call(f.receptionist, "check_in_appointment", booked);
    const walkIn = await call(
      f.receptionist,
      "register_walk_in",
      session,
      await createPatient(f.clinicId, f.receptionist),
      false,
      null,
    );
    expect(await appointment(walkIn)).toMatchObject({ status: "checked_in", waiting_number: 2, placement_open: false });
    expect(await call(f.doctorUser, "call_next_patient", session)).toBe(booked);
    await call(f.doctorUser, "complete_appointment", booked);
    expect((await appointment(booked)).status).toBe("completed");
  });

  it("receptionist_placement: walk-in can be placed ahead", async () => {
    const session = await queueSession({ walk_in: "receptionist_placement" }, 5);
    const booked = await book(f.receptionist, session, await createPatient(f.clinicId, f.receptionist));
    await call(f.receptionist, "check_in_appointment", booked);
    const walkIn = await call(
      f.receptionist,
      "register_walk_in",
      session,
      await createPatient(f.clinicId, f.receptionist),
      false,
      null,
    );
    await call(f.receptionist, "place_in_queue", walkIn, booked);
    expect(await call(f.doctorUser, "call_next_patient", session)).toBe(walkIn);
  });

  it("walk-ins count toward capacity", async () => {
    const session = await queueSession({}, 1);
    await call(
      f.receptionist,
      "register_walk_in",
      session,
      await createPatient(f.clinicId, f.receptionist),
      false,
      null,
    );
    await asUser(f.receptionist, async (db) =>
      expectPgError(
        db.query("select public.register_walk_in($1, $2, false, null)", [
          session,
          await createPatient(f.clinicId, f.receptionist),
        ]),
        /session_full/,
      ),
    );
  });
});

describe("no-show (APT-014, manual)", () => {
  it("reception marks a booked patient as no-show after the session started; doctors cannot", async () => {
    const session = await queueSession();
    const id = await book(f.receptionist, session, await createPatient(f.clinicId, f.receptionist));
    await asUser(f.doctorUser, (db) =>
      expectPgError(db.query("select public.mark_no_show($1, null)", [id]), /forbidden/),
    );
    await call(f.receptionist, "mark_no_show", id, "Synthetic: did not attend");
    expect((await appointment(id)).status).toBe("no_show");
  });

  it("cannot be marked before the session starts", async () => {
    await setPolicy(f.clinicId, f.doctorId, f.owner, { method: "queue" });
    const future = await createSession(f, f.doctorId, { method: "queue", daysFromToday: 2 });
    const id = await book(f.receptionist, future, await createPatient(f.clinicId, f.receptionist));
    await asUser(f.receptionist, (db) =>
      expectPgError(db.query("select public.mark_no_show($1, null)", [id]), /too_early/),
    );
  });
});

describe("visibility (APT-015, STA-006)", () => {
  it("reception sees all doctors' appointments; each doctor only their own; cashier none", async () => {
    await setPolicy(f.clinicId, f.doctorId, f.owner, { method: "queue" });
    await setPolicy(f.clinicId, f.otherDoctorId, f.owner, { method: "queue" });
    const s1 = await createSession(f, f.doctorId, { method: "queue" });
    const s2 = await createSession(f, f.otherDoctorId, { method: "queue" });
    const p1 = await createPatient(f.clinicId, f.receptionist, "Synthetic A");
    const p2 = await createPatient(f.clinicId, f.receptionist, "Synthetic B");
    await book(f.receptionist, s1, p1);
    await book(f.receptionist, s2, p2);

    const count = (user: string, table: string) =>
      asUser(user, async (db) => (await db.query(`select 1 from public.${table}`)).rowCount);
    expect(await count(f.receptionist, "appointments")).toBe(2);
    expect(await count(f.doctorUser, "appointments")).toBe(1);
    expect(await count(f.cashier, "appointments")).toBe(0);
    expect(await count(f.doctorUser, "clinic_patients")).toBe(1);
    expect(await count(f.doctorUser, "patient_identities")).toBe(1);
    expect(await count(f.receptionist, "patient_identities")).toBe(2);
    expect(await count(f.cashier, "patient_identities")).toBe(0);
    expect(await count(f.doctorUser, "appointment_events")).toBe(1);
    expect(await count(f.receptionist, "appointment_events")).toBe(2);
    expect(await count(f.cashier, "clinic_patients")).toBe(0);
    expect(await count(f.manager, "appointments")).toBe(0);
  });

  it("a manager manages appointments only after the owner grants appointments.manage", async () => {
    const session = await queueSession();
    const patient = await createPatient(f.clinicId, f.receptionist);
    await asUser(f.manager, (db) =>
      expectPgError(
        db.query("select public.book_appointment($1, $2, null, false, null)", [session, patient]),
        /forbidden/,
      ),
    );
    await call(f.owner, "set_role_permission", f.clinicId, "manager", "appointments.manage", true);
    await book(f.manager, session, patient);
  });

  it("appointment history is append-only and records each transition", async () => {
    const session = await queueSession();
    const id = await book(f.receptionist, session, await createPatient(f.clinicId, f.receptionist));
    await call(f.receptionist, "check_in_appointment", id);
    const { rows } = await adminPool().query(
      "select action, from_status, to_status, actor_user_id from public.appointment_events where appointment_id = $1 order by occurred_at",
      [id],
    );
    expect(rows).toEqual([
      { action: "booked", from_status: null, to_status: "booked", actor_user_id: f.receptionist },
      { action: "checked_in", from_status: "booked", to_status: "checked_in", actor_user_id: f.receptionist },
    ]);
    await expectPgError(
      adminPool().query("delete from public.appointment_events where appointment_id = $1", [id]),
      /append-only/,
    );
  });

  it("clients cannot write appointments directly", async () => {
    const session = await queueSession();
    const patient = await createPatient(f.clinicId, f.receptionist);
    await asUser(f.receptionist, (db) =>
      expectPgError(
        db.query(
          "insert into public.appointments (clinic_id, clinic_doctor_id, session_id, clinic_patient_id, method, reservation_number, status, source) values ($1, $2, $3, $4, 'queue', 99, 'booked', 'reception')",
          [f.clinicId, f.doctorId, session, patient],
        ),
        /permission denied/,
      ),
    );
  });
});
