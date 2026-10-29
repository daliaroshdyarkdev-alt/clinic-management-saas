// Concurrency (APT-016, acceptance scenario 3): parallel transactions on
// separate connections, each committing independently.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminPool, asCommitted, asUserCommitted, closePool } from "./helpers";
import { createPatient, createSession, freeSlots, setPolicy, setupClinic, type ClinicFixture } from "./fixtures";

afterAll(closePool);

let f: ClinicFixture;
beforeEach(async () => {
  f = await setupClinic();
});

const PARALLEL = 8;

async function settle(promises: Promise<unknown>[]) {
  const results = await Promise.allSettled(promises);
  return {
    ok: results.filter((r) => r.status === "fulfilled").length,
    errors: results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => (r.reason as Error).message),
  };
}

const bookAs = (user: string, session: string, patient: string, startsAt: string | null) =>
  asUserCommitted(user, (db) =>
    db.query("select public.book_appointment($1, $2, $3, false, null)", [session, patient, startsAt]),
  );

describe("parallel bookings", () => {
  it(`${PARALLEL} receptionists race for the last queue place: exactly one wins`, async () => {
    await setPolicy(f.clinicId, f.doctorId, f.owner, { method: "queue" });
    const session = await createSession(f, f.doctorId, { method: "queue", capacity: 3 });
    for (let i = 0; i < 2; i++)
      await bookAs(f.receptionist, session, await createPatient(f.clinicId, f.receptionist), null);

    const patients = await Promise.all(
      Array.from({ length: PARALLEL }, () => createPatient(f.clinicId, f.receptionist)),
    );
    const result = await settle(patients.map((p) => bookAs(f.receptionist, session, p, null)));

    expect(result.ok).toBe(1);
    expect(new Set(result.errors)).toEqual(new Set(["session_full"]));
    const { rows } = await adminPool().query<{ n: number; max: number; distinct: number }>(
      `select count(*)::int as n, max(reservation_number) as max, count(distinct reservation_number)::int as distinct
         from public.appointments where session_id = $1 and status <> 'cancelled'`,
      [session],
    );
    expect(rows[0]).toEqual({ n: 3, max: 3, distinct: 3 });
  });

  it(`${PARALLEL} parallel bookings of the same timed slot: exactly one wins`, async () => {
    await setPolicy(f.clinicId, f.doctorId, f.owner, { method: "timed", slot_minutes: 15 });
    const session = await createSession(f, f.doctorId, { method: "timed", slotMinutes: 15 });
    const [slot] = await freeSlots(session);
    const patients = await Promise.all(
      Array.from({ length: PARALLEL }, () => createPatient(f.clinicId, f.receptionist)),
    );
    const result = await settle(patients.map((p) => bookAs(f.receptionist, session, p, slot)));
    expect(result.ok).toBe(1);
    expect(new Set(result.errors)).toEqual(new Set(["slot_taken"]));
  });

  it(`${PARALLEL} parallel check-ins receive distinct, gap-free waiting numbers`, async () => {
    await setPolicy(f.clinicId, f.doctorId, f.owner, { method: "queue" });
    const session = await createSession(f, f.doctorId, { method: "queue", capacity: PARALLEL });
    const ids: string[] = [];
    for (let i = 0; i < PARALLEL; i++) {
      const patient = await createPatient(f.clinicId, f.receptionist);
      const { rows } = await asUserCommitted(f.receptionist, (db) =>
        db.query<{ id: string }>("select public.book_appointment($1, $2, null, false, null) as id", [session, patient]),
      );
      ids.push(rows[0].id);
    }
    const result = await settle(
      ids.map((id) =>
        asUserCommitted(f.receptionist, (db) => db.query("select public.check_in_appointment($1)", [id])),
      ),
    );
    expect(result.ok).toBe(PARALLEL);
    const { rows } = await adminPool().query<{ waiting_number: number }>(
      "select waiting_number from public.appointments where session_id = $1 order by waiting_number",
      [session],
    );
    expect(rows.map((r) => r.waiting_number)).toEqual(Array.from({ length: PARALLEL }, (_, i) => i + 1));
  });

  it("two patients accepting alternatives for the last place: one confirmed, one told it is unavailable", async () => {
    await adminPool().query("update public.clinics set online_booking_enabled = true where id = $1", [f.clinicId]);
    await setPolicy(f.clinicId, f.doctorId, f.owner, { method: "queue" });
    const requested = await createSession(f, f.doctorId, { method: "queue", capacity: 1, daysFromToday: 1 });
    const alternative = await createSession(f, f.doctorId, { method: "queue", capacity: 1, daysFromToday: 2 });

    const tokens: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { rows } = await asCommitted("service_role", null, (db) =>
        db.query<{ id: string }>("select public.public_submit_booking_request($1, $2, null, $3, $4) as id", [
          f.clinicId,
          requested,
          `Synthetic Requester ${i}`,
          `+2010000000${10 + i}`,
        ]),
      );
      const patient = await createPatient(f.clinicId, f.receptionist);
      const token = await asUserCommitted(
        f.receptionist,
        async (db) =>
          (
            await db.query("select public.propose_alternative($1, $2, $3, null) as t", [
              rows[0].id,
              patient,
              alternative,
            ])
          ).rows[0].t,
      );
      tokens.push(token);
    }

    const responses = await Promise.all(
      tokens.map((t) =>
        asCommitted(
          "service_role",
          null,
          async (db) =>
            (await db.query<{ r: string }>("select public.public_respond_to_offer($1, true) as r", [t])).rows[0].r,
        ),
      ),
    );
    expect(responses.sort()).toEqual(["confirmed", "unavailable"]);

    const { rows } = await adminPool().query(
      "select status, needs_attention from public.appointment_requests where clinic_id = $1 order by status",
      [f.clinicId],
    );
    expect(rows).toEqual([
      { status: "confirmed", needs_attention: false },
      { status: "unavailable", needs_attention: true },
    ]);
    const booked = await adminPool().query("select count(*)::int as n from public.appointments where session_id = $1", [
      alternative,
    ]);
    expect(booked.rows[0].n).toBe(1);
  });
});
