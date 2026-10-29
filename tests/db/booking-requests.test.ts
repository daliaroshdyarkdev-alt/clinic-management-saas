// Online booking requests and alternative proposals. SRS APT-001..003.
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminPool, as, asAnon, asCommitted, asUser, asUserCommitted, closePool, expectPgError } from "./helpers";
import { createPatient, createSession, freeSlots, setPolicy, setupClinic, type ClinicFixture } from "./fixtures";

afterAll(closePool);

let f: ClinicFixture;
let session: string;

beforeEach(async () => {
  f = await setupClinic();
  await adminPool().query("update public.clinics set online_booking_enabled = true where id = $1", [f.clinicId]);
  await setPolicy(f.clinicId, f.doctorId, f.owner, { method: "queue" });
  session = await createSession(f, f.doctorId, { method: "queue", capacity: 2, daysFromToday: 1 });
});

const submit = (clinicId: string, sessionId: string, phone = "+201000000050", startsAt: string | null = null) =>
  asCommitted(
    "service_role",
    null,
    async (db) =>
      (
        await db.query<{ id: string }>(
          "select public.public_submit_booking_request($1, $2, $3, 'Synthetic Requester', $4) as id",
          [clinicId, sessionId, startsAt, phone],
        )
      ).rows[0].id,
  );

const respond = (token: string, accept: boolean) =>
  asCommitted(
    "service_role",
    null,
    async (db) =>
      (await db.query<{ r: string }>("select public.public_respond_to_offer($1, $2) as r", [token, accept])).rows[0].r,
  );

async function request(id: string) {
  const { rows } = await adminPool().query(
    "select status, needs_attention, appointment_id is not null as booked from public.appointment_requests where id = $1",
    [id],
  );
  return rows[0];
}

describe("public side", () => {
  it("public functions are callable only by the server (service role), never by browsers", async () => {
    await asAnon((db) =>
      expectPgError(db.query("select public.public_booking_options($1, 7)", [f.clinicId]), /permission denied/),
    );
    await asUser(f.receptionist, (db) =>
      expectPgError(
        db.query("select public.public_submit_booking_request($1, $2, null, 'X Y', '+201000000000')", [
          f.clinicId,
          session,
        ]),
        /permission denied/,
      ),
    );
    await asAnon((db) => expectPgError(db.query("select * from public.public_get_offer('x')"), /permission denied/));
  });

  it("booking options show capacity and names only, and nothing when online booking is off", async () => {
    const options = await as(
      "service_role",
      null,
      async (db) => (await db.query("select public.public_booking_options($1, 7) as o", [f.clinicId])).rows[0].o,
    );
    expect(options.clinic_name).toMatch(/Synthetic/);
    const doctor = options.doctors.find((d: { name: string }) => d.name === "Synthetic Dr. One");
    expect(doctor.sessions.find((s: { id: string }) => s.id === session)).toMatchObject({
      remaining: 2,
      method: "queue",
    });
    expect(JSON.stringify(options)).not.toMatch(/phone|patient|user_id/);

    await adminPool().query("update public.clinics set online_booking_enabled = false where id = $1", [f.clinicId]);
    const off = await as(
      "service_role",
      null,
      async (db) => (await db.query("select public.public_booking_options($1, 7) as o", [f.clinicId])).rows[0].o,
    );
    expect(off).toBeNull();
    await expectPgError(submit(f.clinicId, session), /online_booking_unavailable/);
  });

  it("a request is not a booking and holds no capacity", async () => {
    const id = await submit(f.clinicId, session);
    expect(await request(id)).toEqual({ status: "submitted", needs_attention: false, booked: false });
    const { rows } = await adminPool().query("select private.session_remaining($1) as n", [session]);
    expect(rows[0].n).toBe(2);
  });

  it("limits open requests per phone number", async () => {
    for (let i = 0; i < 3; i++) await submit(f.clinicId, session, "+201000000060");
    await expectPgError(submit(f.clinicId, session, "+201000000060"), /too_many_requests/);
  });

  it("rejects sessions of another clinic and misaligned timed slots", async () => {
    const other = await setupClinic();
    await setPolicy(other.clinicId, other.doctorId, other.owner, { method: "queue" });
    const otherSession = await createSession(other, other.doctorId, { method: "queue", daysFromToday: 1 });
    await expectPgError(submit(f.clinicId, otherSession), /session_not_found/);

    await setPolicy(f.clinicId, f.otherDoctorId, f.owner, { method: "timed", slot_minutes: 15 });
    const timed = await createSession(f, f.otherDoctorId, { method: "timed", slotMinutes: 15, daysFromToday: 1 });
    const [slot] = await freeSlots(timed);
    const misaligned = new Date(new Date(slot).getTime() + 7 * 60_000).toISOString();
    await expectPgError(submit(f.clinicId, timed, "+201000000070", misaligned), /invalid_slot/);
    await submit(f.clinicId, timed, "+201000000070", slot);
  });
});

describe("reception decisions (APT-002)", () => {
  it("approve books the requested time for a registered patient", async () => {
    const id = await submit(f.clinicId, session);
    const patient = await createPatient(f.clinicId, f.receptionist);
    await asUserCommitted(f.receptionist, (db) =>
      db.query("select public.approve_booking_request($1, $2, false, null)", [id, patient]),
    );
    expect(await request(id)).toMatchObject({ status: "confirmed", booked: true });
    await asUser(f.receptionist, (db) =>
      expectPgError(
        db.query("select public.approve_booking_request($1, $2, false, null)", [id, patient]),
        /request_not_open/,
      ),
    );
  });

  it("reject requires a reason", async () => {
    const id = await submit(f.clinicId, session);
    await asUser(f.receptionist, (db) =>
      expectPgError(db.query("select public.reject_booking_request($1, ' ')", [id]), /reason_required/),
    );
    await asUserCommitted(f.receptionist, (db) =>
      db.query("select public.reject_booking_request($1, 'Synthetic: doctor unavailable')", [id]),
    );
    expect((await request(id)).status).toBe("rejected");
  });

  it("only reception of the same clinic sees and decides requests", async () => {
    const id = await submit(f.clinicId, session);
    const other = await setupClinic();
    const otherPatient = await createPatient(other.clinicId, other.receptionist);
    await asUser(other.receptionist, (db) =>
      expectPgError(
        db.query("select public.approve_booking_request($1, $2, false, null)", [id, otherPatient]),
        /forbidden/,
      ),
    );
    await asUser(f.doctorUser, (db) =>
      expectPgError(db.query("select public.reject_booking_request($1, 'x')", [id]), /forbidden/),
    );
    const seen = (user: string) =>
      asUser(user, async (db) => (await db.query("select id from public.appointment_requests")).rowCount);
    expect(await seen(f.receptionist)).toBe(1);
    expect(await seen(other.receptionist)).toBe(0);
    expect(await seen(f.doctorUser)).toBe(0);
  });
});

describe("alternative proposals (APT-003)", () => {
  async function propose(requestId: string, target = session) {
    const patient = await createPatient(f.clinicId, f.receptionist);
    const token = await asUserCommitted(
      f.receptionist,
      async (db) =>
        (
          await db.query<{ t: string }>("select public.propose_alternative($1, $2, $3, null) as t", [
            requestId,
            patient,
            target,
          ])
        ).rows[0].t,
    );
    return { token, patient };
  }

  it("the patient sees the offer and accepting books it", async () => {
    const id = await submit(f.clinicId, session);
    const { token } = await propose(id);
    const offer = await as(
      "service_role",
      null,
      async (db) =>
        (await db.query("select status, doctor_name, method from public.public_get_offer($1)", [token])).rows[0],
    );
    expect(offer).toEqual({ status: "offered", doctor_name: "Synthetic Dr. One", method: "queue" });
    expect(await respond(token, true)).toBe("confirmed");
    expect(await request(id)).toMatchObject({ status: "confirmed", booked: true });
    await expectPgError(respond(token, true), /offer_closed/);
  });

  it("an offer holds no capacity: if the place is gone on acceptance, nothing is booked and reception is alerted", async () => {
    const id = await submit(f.clinicId, session);
    const { token } = await propose(id);
    for (let i = 0; i < 2; i++) {
      const p = await createPatient(f.clinicId, f.receptionist);
      await asUserCommitted(f.receptionist, (db) =>
        db.query("select public.book_appointment($1, $2, null, false, null)", [session, p]),
      );
    }
    expect(await respond(token, true)).toBe("unavailable");
    expect(await request(id)).toEqual({ status: "unavailable", needs_attention: true, booked: false });
  });

  it("declining alerts reception; a new proposal withdraws the previous link", async () => {
    const id = await submit(f.clinicId, session);
    const first = await propose(id);
    const second = await propose(id);
    await expectPgError(respond(first.token, true), /offer_closed/);
    expect(await respond(second.token, false)).toBe("declined");
    expect(await request(id)).toMatchObject({ status: "alternative_declined", needs_attention: true });
  });

  it("offer tokens are stored hashed and the hash is not readable by staff", async () => {
    const id = await submit(f.clinicId, session);
    const { token } = await propose(id);
    const { rows } = await adminPool().query<{ token_hash: Buffer }>(
      "select token_hash from public.alternative_offers where request_id = $1",
      [id],
    );
    expect(rows[0].token_hash.equals(createHash("sha256").update(token).digest())).toBe(true);
    await asUser(f.receptionist, (db) =>
      expectPgError(db.query("select token_hash from public.alternative_offers"), /permission denied/),
    );
    await expectPgError(respond("unknown-token-value", true), /offer_invalid/);
  });
});
