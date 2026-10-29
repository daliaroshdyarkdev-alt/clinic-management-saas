// WhatsApp transactional messaging. SRS WAP-001..014, WAP-016 and acceptance
// scenarios 8 (webhook replay), 9 (budget ceiling under concurrency) and 10
// (consent withdrawn before dispatch).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminPool,
  as,
  asCommitted,
  asUser,
  asUserCommitted,
  closePool,
  createUser,
  expectPgError,
  makePlatformAdmin,
} from "./helpers";
import { createPatient, createSession, setPolicy, setupClinic, type ClinicFixture } from "./fixtures";

afterAll(closePool);

const ALL_EVENTS = [
  "request_received",
  "request_decision",
  "alternative_proposal",
  "reminder",
  "cancellation",
  "session_cancellation",
  "no_show",
];

let f: ClinicFixture;
let session: string;
let patient: string;
let phoneNumberId: string;

const q = (user: string, sql: string, params: unknown[] = []) =>
  asUserCommitted(user, async (db) => (await db.query(sql, params)).rows[0]?.r);

const service = (sql: string, params: unknown[] = []) =>
  asCommitted("service_role", null, async (db) => (await db.query(sql, params)).rows);

const claim = async (limit = 50) =>
  (await service("select * from public.worker_claim_messages($1)", [limit])) as {
    intent_id: string;
    provider_template: string;
    variables: Record<string, unknown>;
  }[];

const intents = async () =>
  (
    await adminPool().query(
      "select id, event_type, template_key, status, billing_kind, cost_minor, attempts, last_error_code, provider_message_id from public.message_intents where clinic_id = $1 order by created_at, id",
      [f.clinicId],
    )
  ).rows;

const alerts = async (kind: string) =>
  Number(
    (
      await adminPool().query("select count(*) as n from public.messaging_alerts where clinic_id = $1 and kind = $2", [
        f.clinicId,
        kind,
      ])
    ).rows[0].n,
  );

const book = (patientId = patient) =>
  q(f.receptionist, "select public.book_appointment($1, $2, null, false, null) as r", [session, patientId]);

const consent = (granted: boolean, patientId = patient) =>
  q(f.receptionist, "select public.record_messaging_consent($1, $2, 'receptionist') as r", [patientId, granted]);

async function configure(events = ALL_EVENTS, offsets: number[] = []) {
  await q(f.owner, "select public.set_notification_settings($1, $2, $3, 'ar') as r", [f.clinicId, events, offsets]);
}

beforeEach(async () => {
  // The worker claims across clinics; park anything left by earlier tests.
  await adminPool().query(
    "update public.message_intents set status = 'cancelled' where status in ('queued', 'sending')",
  );
  await adminPool().query("update public.whatsapp_template_catalog set approved = true");
  f = await setupClinic();
  await adminPool().query("update public.clinics set online_booking_enabled = true where id = $1", [f.clinicId]);
  await setPolicy(f.clinicId, f.doctorId, f.owner, { method: "queue" });
  session = await createSession(f, f.doctorId, { method: "queue", capacity: 20, daysFromToday: 1 });
  patient = await createPatient(f.clinicId, f.owner);
  phoneNumberId = String(Date.now()) + String(Math.floor(Math.random() * 1000));
  await q(
    f.owner,
    "select public.configure_whatsapp_connection($1, 'clinic_owned', $2, '+20 100 000 0000', 'WA_TEST') as r",
    [f.clinicId, phoneNumberId],
  );
  await service("select public.worker_set_connection_status($1, 'connected', null)", [f.clinicId]);
  await adminPool().query(
    "insert into public.platform_settings (key, value) values ('messaging.default_allowance', '100') on conflict (key) do update set value = excluded.value",
  );
});

describe("outbox events (WAP-002, WAP-003)", () => {
  it("creates nothing while an event is disabled, and one idempotent intent when enabled", async () => {
    const a1 = await book();
    await q(f.receptionist, "select public.cancel_appointment($1, 'Synthetic reason') as r", [a1]);
    expect(await intents()).toHaveLength(0);

    await configure();
    const a2 = await book();
    await q(f.receptionist, "select public.cancel_appointment($1, 'Synthetic reason') as r", [a2]);
    const rows = await intents();
    expect(rows.map((r) => r.template_key)).toEqual(["cancellation"]);
  });

  it("queues session cancellation notices for every affected booking", async () => {
    await configure();
    const other = await createPatient(f.clinicId, f.owner, "Synthetic Second");
    await book();
    await book(other);
    await q(f.receptionist, "select public.cancel_doctor_session($1, 'Synthetic reason') as r", [session]);
    expect((await intents()).filter((r) => r.template_key === "session_cancellation")).toHaveLength(2);
  });

  it("schedules reminders once per offset and marks them obsolete if the appointment is cancelled", async () => {
    await configure(ALL_EVENTS, [60, 120]);
    const appt = await book();
    expect(await service("select public.worker_schedule_reminders() as n")).toEqual([{ n: 2 }]);
    expect(await service("select public.worker_schedule_reminders() as n")).toEqual([{ n: 0 }]);
    await consent(true);
    await adminPool().query("update public.message_intents set scheduled_for = now() where clinic_id = $1", [
      f.clinicId,
    ]);
    await q(f.receptionist, "select public.cancel_appointment($1, 'Synthetic reason') as r", [appt]);
    await claim();
    const rows = await intents();
    expect(rows.filter((r) => r.template_key === "reminder").map((r) => r.status)).toEqual(["obsolete", "obsolete"]);
    expect(rows.find((r) => r.template_key === "cancellation")?.status).toBe("sending");
  });
});

describe("consent (WAP-008, WAP-009, scenario 10)", () => {
  it("never sends without consent", async () => {
    await configure();
    const appt = await book();
    await q(f.receptionist, "select public.cancel_appointment($1, 'Synthetic reason') as r", [appt]);
    expect(await claim()).toHaveLength(0);
    expect((await intents())[0].status).toBe("blocked_consent");
  });

  it("cancels queued messages when consent is withdrawn before dispatch", async () => {
    await configure();
    await consent(true);
    const appt = await book();
    await q(f.receptionist, "select public.cancel_appointment($1, 'Synthetic reason') as r", [appt]);
    await consent(false);
    expect(await claim()).toHaveLength(0);
    const [row] = await intents();
    expect(row.status).toBe("cancelled");
    expect(row.last_error_code).toBe("consent_withdrawn");
  });

  it("re-checks consent at send time even if the queue was not updated", async () => {
    await configure();
    await consent(true);
    const appt = await book();
    await q(f.receptionist, "select public.cancel_appointment($1, 'Synthetic reason') as r", [appt]);
    // Withdrawal recorded by another path that did not touch the outbox.
    await adminPool().query(
      "insert into public.messaging_consents (clinic_id, clinic_patient_id, granted, source) values ($1, $2, false, 'secure_link')",
      [f.clinicId, patient],
    );
    expect(await claim()).toHaveLength(0);
    expect((await intents())[0].status).toBe("blocked_consent");
  });

  it("uses the online checkbox for request messages and records it as consent on approval", async () => {
    await configure();
    const submit = (phone: string, ok: boolean) =>
      service("select public.public_submit_booking_request($1, $2, null, 'Synthetic Requester', $3, $4) as id", [
        f.clinicId,
        session,
        phone,
        ok,
      ]).then((r) => r[0].id as string);
    const withConsent = await submit("+201000000071", true);
    await submit("+201000000072", false);
    const claimed = await claim();
    expect(claimed).toHaveLength(1);
    expect((await intents()).map((r) => r.status).sort()).toEqual(["blocked_consent", "sending"]);

    await q(f.receptionist, "select public.approve_booking_request($1, $2, false, null) as r", [withConsent, patient]);
    const { rows } = await adminPool().query(
      "select granted, source from public.messaging_consents where clinic_patient_id = $1",
      [patient],
    );
    expect(rows).toEqual([{ granted: true, source: "online_checkbox" }]);
  });

  it("consent history is append-only", async () => {
    await consent(true);
    await expectPgError(
      adminPool().query("delete from public.messaging_consents where clinic_patient_id = $1", [patient]),
      /append-only/,
    );
  });
});

describe("send-time configuration checks (WAP-004, WAP-011)", () => {
  it("blocks unapproved templates and raises a configuration alert", async () => {
    await configure();
    await consent(true);
    await adminPool().query(
      "update public.whatsapp_template_catalog set approved = false where template_key = 'cancellation'",
    );
    const appt = await book();
    await q(f.receptionist, "select public.cancel_appointment($1, 'Synthetic reason') as r", [appt]);
    expect(await claim()).toHaveLength(0);
    expect((await intents())[0].status).toBe("blocked_config");
    expect(await alerts("config_blocked")).toBe(1);
  });

  it("holds messages while the connection is down and resumes on recovery with alerts once per change", async () => {
    await configure();
    await consent(true);
    await service("select public.worker_set_connection_status($1, 'error', 'synthetic')", [f.clinicId]);
    await service("select public.worker_set_connection_status($1, 'error', 'synthetic')", [f.clinicId]);
    const appt = await book();
    await q(f.receptionist, "select public.cancel_appointment($1, 'Synthetic reason') as r", [appt]);
    expect(await claim()).toHaveLength(0);
    expect((await intents())[0].status).toBe("queued");
    await service("select public.worker_set_connection_status($1, 'connected', null)", [f.clinicId]);
    expect(await claim()).toHaveLength(1);
    expect(await alerts("connection_down")).toBe(1);
    expect(await alerts("connection_restored")).toBe(1);
  });

  it("never exposes access tokens: connections store only a credential reference", async () => {
    const { rows } = await adminPool().query(
      "select column_name from information_schema.columns where table_name = 'whatsapp_connections' and column_name ~ 'token|secret'",
    );
    expect(rows).toHaveLength(0);
  });
});

describe("budget (WAP-013, scenario 9)", () => {
  async function queueManual(n: number) {
    await consent(true);
    const appt = await book();
    for (let i = 0; i < n; i++) {
      await q(f.owner, "select public.send_manual_message($1, 'reminder') as r", [appt]);
    }
  }

  it("parallel workers never exceed the ceiling and alerts fire once", async () => {
    await adminPool().query(
      "update public.platform_settings set value = '1' where key = 'messaging.default_allowance'",
    );
    await adminPool().query(
      "update public.platform_settings set value = '100' where key = 'messaging.overage_unit_minor'",
    );
    await q(f.owner, "select public.set_messaging_ceiling($1, 250) as r", [f.clinicId]);
    await queueManual(6);

    const results = await Promise.all(Array.from({ length: 6 }, () => claim(1)));
    expect(results.flat()).toHaveLength(3);

    const rows = await intents();
    expect(
      rows
        .filter((r) => r.status === "sending")
        .map((r) => r.billing_kind)
        .sort(),
    ).toEqual(["allowance", "overage", "overage"]);
    expect(rows.filter((r) => r.status === "blocked_budget")).toHaveLength(3);
    const { rows: budget } = await adminPool().query(
      "select used_count, overage_spent_minor::int as spent from public.messaging_budgets where clinic_id = $1",
      [f.clinicId],
    );
    expect(budget).toEqual([{ used_count: 1, spent: 200 }]);
    expect(await alerts("budget_80")).toBe(1);
    expect(await alerts("budget_100")).toBe(1);
  });

  it("a second worker waits for the first worker's reservation (interleaved transactions)", async () => {
    await adminPool().query(
      "update public.platform_settings set value = '1' where key = 'messaging.default_allowance'",
    );
    await adminPool().query(
      "update public.platform_settings set value = 'null' where key = 'messaging.overage_unit_minor'",
    );
    await queueManual(2);
    // Create this period's budget row up front so both workers contend on it.
    await adminPool().query(
      "insert into public.messaging_budgets (clinic_id, period_month, allowance_count) values ($1, date_trunc('month', now() at time zone 'Africa/Cairo')::date, 1)",
      [f.clinicId],
    );
    const open = async () => {
      const c = await adminPool().connect();
      await c.query("begin");
      await c.query("set local role service_role");
      return c;
    };
    const w1 = await open();
    const w2 = await open();
    try {
      const first = await w1.query("select * from public.worker_claim_messages(1)");
      const second = w2.query("select * from public.worker_claim_messages(1)");
      await new Promise((r) => setTimeout(r, 300));
      await w1.query("commit");
      const secondRows = (await second).rows;
      await w2.query("commit");
      expect(first.rows.length + secondRows.length).toBe(1);
    } finally {
      w1.release();
      w2.release();
    }
    const { rows } = await adminPool().query("select used_count from public.messaging_budgets where clinic_id = $1", [
      f.clinicId,
    ]);
    expect(rows[0].used_count).toBe(1);
  });

  it("without a ceiling nothing beyond the allowance is sent", async () => {
    await adminPool().query(
      "update public.platform_settings set value = '1' where key = 'messaging.default_allowance'",
    );
    await adminPool().query(
      "update public.platform_settings set value = '100' where key = 'messaging.overage_unit_minor'",
    );
    await queueManual(2);
    expect(await claim()).toHaveLength(1);
    expect((await intents()).map((r) => r.status).sort()).toEqual(["blocked_budget", "sending"]);
  });

  it("failures release the reservation; retries back off and stop after five attempts", async () => {
    await queueManual(1);
    const [c] = await claim();
    expect(
      await service("select public.worker_record_send_result($1, false, null, 'timeout', true) as r", [c.intent_id]),
    ).toEqual([{ r: "retry" }]);
    expect(await claim()).toHaveLength(0); // backing off
    for (let attempt = 2; attempt <= 5; attempt++) {
      await adminPool().query("update public.message_intents set next_attempt_at = now() where id = $1", [c.intent_id]);
      const [again] = await claim();
      const [{ r }] = await service("select public.worker_record_send_result($1, false, null, 'timeout', true) as r", [
        again.intent_id,
      ]);
      expect(r).toBe(attempt < 5 ? "retry" : "failed");
    }
    const [row] = await intents();
    expect(row).toMatchObject({ status: "failed", attempts: 5, billing_kind: null });
    const { rows } = await adminPool().query("select used_count from public.messaging_budgets where clinic_id = $1", [
      f.clinicId,
    ]);
    expect(rows[0].used_count).toBe(0);
    expect(await alerts("send_failed")).toBe(1);
  });
});

describe("webhooks (WAP-006, WAP-016, scenario 8)", () => {
  const hook = (
    eventId: string,
    kind: string,
    messageId: string | null,
    status: string | null,
    reply: string | null = null,
    billable: boolean | null = null,
  ) =>
    service("select public.process_whatsapp_webhook($1, $2, $3, $4, $5, $6, null, $7) as r", [
      eventId,
      phoneNumberId,
      kind,
      messageId,
      status,
      billable,
      reply,
    ]).then((r) => r[0].r as string);

  async function sentMessage() {
    await configure();
    await consent(true);
    const appt = await book();
    await q(f.receptionist, "select public.cancel_appointment($1, 'Synthetic reason') as r", [appt]);
    const [c] = await claim();
    const providerId = `wamid.${c.intent_id}`;
    await service("select public.worker_record_send_result($1, true, $2, null, false)", [c.intent_id, providerId]);
    return providerId;
  }

  it("replays are no-ops and statuses never move backwards", async () => {
    const id = await sentMessage();
    const ev = `ev-${id}`;
    expect(await hook(`${ev}-1`, "status", id, "delivered")).toBe("status");
    expect(await hook(`${ev}-1`, "status", id, "delivered")).toBe("duplicate");
    expect(await hook(`${ev}-2`, "status", id, "sent")).toBe("status");
    expect((await intents())[0].status).toBe("delivered");
    expect(await hook(`${ev}-3`, "status", id, "read")).toBe("status");
    expect(await hook(`${ev}-4`, "status", id, "failed")).toBe("status");
    expect((await intents())[0].status).toBe("read");
  });

  it("a failed non-billable receipt releases the charge exactly once", async () => {
    await adminPool().query(
      "update public.platform_settings set value = '0' where key = 'messaging.default_allowance'",
    );
    await adminPool().query(
      "update public.platform_settings set value = '100' where key = 'messaging.overage_unit_minor'",
    );
    await q(f.owner, "select public.set_messaging_ceiling($1, 1000) as r", [f.clinicId]);
    const id = await sentMessage();
    expect(await hook(`ev-${id}`, "status", id, "failed", null, false)).toBe("status");
    const { rows } = await adminPool().query(
      "select overage_spent_minor::int as spent from public.messaging_budgets where clinic_id = $1",
      [f.clinicId],
    );
    expect(rows[0].spent).toBe(0);
    expect((await intents())[0]).toMatchObject({ status: "failed", billing_kind: null });
  });

  it("an offer button is processed once; free text goes to reception", async () => {
    await configure();
    const requestId = (
      await service(
        "select public.public_submit_booking_request($1, $2, null, 'Synthetic Requester', '+201000000081', true) as id",
        [f.clinicId, session],
      )
    )[0].id;
    await q(f.receptionist, "select public.propose_alternative($1, $2, $3, null) as r", [requestId, patient, session]);
    const { rows } = await adminPool().query("select id from public.alternative_offers where request_id = $1", [
      requestId,
    ]);
    const offer = rows[0].id;
    const proposal = (await intents()).find((r) => r.template_key === "alternative_proposal");
    expect(proposal).toBeDefined();

    expect(await hook(`btn-${offer}`, "reply", null, null, `offer_accept:${offer}`)).toBe("offer_confirmed");
    expect(await hook(`btn-${offer}`, "reply", null, null, `offer_accept:${offer}`)).toBe("duplicate");
    expect(await hook(`btn2-${offer}`, "reply", null, null, `offer_decline:${offer}`)).toBe("offer_closed");
    const { rows: appts } = await adminPool().query(
      "select count(*)::int as n from public.appointments where clinic_patient_id = $1 and status = 'booked'",
      [patient],
    );
    expect(appts[0].n).toBe(1);

    expect(await hook(`txt-${offer}`, "reply", null, null, "hello")).toBe("routed_to_reception");
    expect(await alerts("patient_reply")).toBe(1);
  });

  it("ignores another clinic's offer ids and unknown numbers", async () => {
    const other = await setupClinic();
    const otherPatient = await createPatient(other.clinicId, other.owner);
    await adminPool().query("update public.clinics set online_booking_enabled = true where id = $1", [other.clinicId]);
    await setPolicy(other.clinicId, other.doctorId, other.owner, { method: "queue" });
    const otherSession = await createSession(other, other.doctorId, { method: "queue", daysFromToday: 1 });
    const req = (
      await service(
        "select public.public_submit_booking_request($1, $2, null, 'Synthetic Requester', '+201000000082', true) as id",
        [other.clinicId, otherSession],
      )
    )[0].id;
    await q(other.receptionist, "select public.propose_alternative($1, $2, $3, null) as r", [
      req,
      otherPatient,
      otherSession,
    ]);
    const { rows } = await adminPool().query("select id, status from public.alternative_offers where request_id = $1", [
      req,
    ]);
    expect(await hook(`x-${rows[0].id}`, "reply", null, null, `offer_accept:${rows[0].id}`)).toBe(
      "routed_to_reception",
    );
    const { rows: after } = await adminPool().query("select status from public.alternative_offers where id = $1", [
      rows[0].id,
    ]);
    expect(after[0].status).toBe("offered");
    expect(
      (
        await service(
          "select public.process_whatsapp_webhook('u-1', '99999', 'status', 'x', 'read', null, null, null) as r",
        )
      )[0].r,
    ).toBe("unknown_number");
  });
});

describe("permissions and tenant isolation (WAP-012, WAP-014)", () => {
  it("worker and webhook functions are service-role only", async () => {
    for (const sql of [
      "select * from public.worker_claim_messages(1)",
      "select public.worker_schedule_reminders()",
      "select public.process_whatsapp_webhook('a', 'b', 'status', null, null, null, null, null)",
      "select * from public.worker_connections()",
    ]) {
      await asUser(f.owner, (db) => expectPgError(db.query(sql), /permission denied/));
      await as("anon", null, (db) => expectPgError(db.query(sql), /permission denied/));
    }
  });

  it("message log hides variables and other clinics' rows", async () => {
    await configure();
    await consent(true);
    const appt = await book();
    await q(f.receptionist, "select public.cancel_appointment($1, 'Synthetic reason') as r", [appt]);
    await asUser(f.owner, (db) =>
      expectPgError(db.query("select variables from public.message_intents"), /permission denied/),
    );
    await asUser(f.owner, async (db) => {
      const { rows } = await db.query("select id from public.message_intents where clinic_id = $1", [f.clinicId]);
      expect(rows).toHaveLength(1);
    });
    const other = await setupClinic();
    await asUser(other.owner, async (db) => {
      for (const table of [
        "message_intents",
        "messaging_consents",
        "whatsapp_connections",
        "messaging_alerts",
        "messaging_budgets",
      ]) {
        const { rows } = await db.query(`select clinic_id from public.${table} where clinic_id = $1`, [f.clinicId]);
        expect(rows, table).toHaveLength(0);
      }
    });
    await asUser(f.cashier, async (db) => {
      const { rows } = await db.query("select id from public.message_intents where clinic_id = $1", [f.clinicId]);
      expect(rows).toHaveLength(0);
    });
  });

  it("manual sends and the spending ceiling need owner-granted permissions", async () => {
    await consent(true);
    const appt = await book();
    await asUser(f.receptionist, (db) =>
      expectPgError(db.query("select public.send_manual_message($1, 'reminder')", [appt]), /forbidden/),
    );
    await asUser(f.manager, (db) =>
      expectPgError(db.query("select public.set_messaging_ceiling($1, 100)", [f.clinicId]), /forbidden/),
    );
    await q(f.owner, "select public.set_role_permission($1, 'receptionist', 'messaging.send', true) as r", [
      f.clinicId,
    ]);
    await q(f.owner, "select public.set_role_permission($1, 'manager', 'messaging.budget', true) as r", [f.clinicId]);
    await asUser(f.receptionist, (db) => db.query("select public.send_manual_message($1, 'reminder')", [appt]));
    await asUser(f.manager, (db) => db.query("select public.set_messaging_ceiling($1, 100)", [f.clinicId]));
    await asUser(f.owner, (db) =>
      expectPgError(
        db.query("select public.set_role_permission($1, 'cashier', 'messaging.send', true)", [f.clinicId]),
        /capability_not_grantable/,
      ),
    );
  });

  it("platform-managed numbers are configured only by platform admins", async () => {
    await asUser(f.owner, (db) =>
      expectPgError(
        db.query("select public.configure_whatsapp_connection($1, 'platform_managed', '1234567', null, 'X_REF')", [
          f.clinicId,
        ]),
        /platform_managed_by_admin/,
      ),
    );
    await asUser(f.receptionist, (db) =>
      expectPgError(
        db.query("select public.configure_whatsapp_connection($1, 'clinic_owned', '1234567', null, 'X_REF')", [
          f.clinicId,
        ]),
        /forbidden/,
      ),
    );
    await asUser(f.owner, (db) =>
      expectPgError(db.query("select public.admin_review_template(null, null, true)"), /forbidden/),
    );
    const admin = await createUser("m5-admin");
    await makePlatformAdmin(admin);
    await asUser(admin, (db) =>
      db.query("select public.admin_configure_platform_number($1, '7654321', null, 'PLATFORM_REF')", [f.clinicId]),
    );
  });
});
