// SaaS subscriptions and platform billing. SRS SUB-001..010, ADM-002,
// ONB-006 and acceptance scenarios 11 (no early plan changes), 12 (payment
// replay / manual evidence) and 13 (archives retained after closure).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminPool,
  asCommitted,
  asUser,
  asUserCommitted,
  closePool,
  createUser,
  expectPgError,
  makePlatformAdmin,
  putStorageObject,
} from "./helpers";
import { addDoctor, createPatient, createSession, setPolicy, setupClinic, type ClinicFixture } from "./fixtures";

afterAll(closePool);

let admin: string;
let f: ClinicFixture;
let small: string; // version: 2 doctors, 1000.00 EGP monthly
let large: string; // version: 5 doctors

const q = (user: string, sql: string, params: unknown[] = []) =>
  asUserCommitted(user, async (db) => (await db.query(sql, params)).rows[0]?.r);

const service = (sql: string, params: unknown[] = []) =>
  asCommitted("service_role", null, async (db) => (await db.query(sql, params)).rows[0]?.r);

async function publish(limit: number, monthly: number | null, annual: number | null = null) {
  const plan = await q(admin, "select public.admin_create_plan($1, 'خطة', 'Plan') as r", [
    `p_${randomUUID().slice(0, 8)}`,
  ]);
  return (await q(admin, "select public.admin_publish_plan_version($1, $2, $3, $4, 5000, 50000, 100, 50, '{}') as r", [
    plan,
    limit,
    monthly,
    annual,
  ])) as string;
}

const status = async (clinicId = f.clinicId) =>
  (await asUser(
    f.owner,
    async (db) => (await db.query("select * from public.clinic_billing_status($1)", [clinicId])).rows[0],
  )) as {
    state: string;
    doctor_capacity: number;
    active_doctors: number;
    period_end: Date | null;
    next_period_start: Date | null;
    plan_version_id: string | null;
  };

async function gatewayPayment(version: string, period = "monthly", extra = 0) {
  const row = await asUserCommitted(
    f.owner,
    async (db) =>
      (
        await db.query("select * from public.start_gateway_payment($1, $2, $3, $4, 'mockpay')", [
          f.clinicId,
          version,
          period,
          extra,
        ])
      ).rows[0],
  );
  const ref = `ref_${randomUUID()}`;
  await q(f.owner, "select public.attach_gateway_reference($1, $2) as r", [row.payment_id, ref]);
  return { id: row.payment_id as string, amount: Number(row.amount_minor), ref };
}

const webhook = (ref: string, amount: number, eventId = randomUUID(), state = "paid") =>
  service("select public.process_payment_webhook('mockpay', $1, $2, $3, $4) as r", [eventId, ref, state, amount]);

async function manualPayment(version: string, clinicId = f.clinicId, owner = f.owner) {
  const path = `${clinicId}/${randomUUID()}.pdf`;
  await putStorageObject("billing-evidence", path);
  return (await q(
    owner,
    "select public.submit_manual_payment($1, $2, 'monthly', 0, 'instapay', 'IPN-123', $3, 'application/pdf', 1000) as r",
    [clinicId, version, path],
  )) as string;
}

const endTrial = (daysAgo = 0) =>
  adminPool().query(
    "update public.clinic_subscriptions set trial_ends_at = now() - make_interval(days => $2) where clinic_id = $1",
    [f.clinicId, daysAgo],
  );

const count = async (sql: string, params: unknown[]) => Number((await adminPool().query(sql, params)).rows[0].n);

beforeAll(async () => {
  admin = await createUser("m6-admin");
  await makePlatformAdmin(admin);
});

beforeEach(async () => {
  f = await setupClinic();
  small = await publish(2, 100000, 1000000);
  large = await publish(5, 250000);
});

describe("plans and versions (SUB-001, SUB-005, SUB-010)", () => {
  it("only platform admins publish plans, and published versions are immutable", async () => {
    await asUser(f.owner, (db) =>
      expectPgError(db.query("select public.admin_create_plan('x_plan', 'x', 'x')"), /forbidden/),
    );
    await expectPgError(
      adminPool().query("update public.plan_versions set monthly_price_minor = 1 where id = $1", [small]),
      /append-only/,
    );
  });

  it("charges the server-side price and sells only the current version", async () => {
    const p = await gatewayPayment(small, "annual", 2);
    expect(p.amount).toBe(1000000 + 2 * 50000);
    const plan = (await adminPool().query("select plan_id from public.plan_versions where id = $1", [small])).rows[0]
      .plan_id;
    await q(admin, "select public.admin_publish_plan_version($1, 2, 120000, null, null, null, 0, null, '{}') as r", [
      plan,
    ]);
    await asUser(f.owner, (db) =>
      expectPgError(
        db.query("select * from public.start_gateway_payment($1, $2, 'monthly', 0, 'mockpay')", [f.clinicId, small]),
        /plan_not_available/,
      ),
    );
    await asUser(f.owner, (db) =>
      expectPgError(
        db.query("select * from public.start_gateway_payment($1, $2, 'annual', 0, 'mockpay')", [f.clinicId, large]),
        /plan_not_available/,
      ),
    );
  });

  it("a new version never changes terms already paid for", async () => {
    await endTrial();
    const p = await gatewayPayment(small);
    await webhook(p.ref, p.amount);
    const plan = (await adminPool().query("select plan_id from public.plan_versions where id = $1", [small])).rows[0]
      .plan_id;
    await q(admin, "select public.admin_publish_plan_version($1, 1, 999999, null, null, null, 0, null, '{}') as r", [
      plan,
    ]);
    expect((await status()).doctor_capacity).toBe(2);
  });

  it("staff and other clinics cannot start payments", async () => {
    const other = await setupClinic();
    for (const user of [f.manager, f.receptionist, other.owner]) {
      await asUser(user, (db) =>
        expectPgError(
          db.query("select * from public.start_gateway_payment($1, $2, 'monthly', 0, 'mockpay')", [f.clinicId, small]),
          /forbidden/,
        ),
      );
    }
  });
});

describe("gateway payments (SUB-006, scenario 12)", () => {
  it("a replayed or repeated webhook applies one period and one receipt", async () => {
    const p = await gatewayPayment(small);
    const event = randomUUID();
    expect(await webhook(p.ref, p.amount, event)).toBe("applied");
    expect(await webhook(p.ref, p.amount, event)).toBe("duplicate");
    expect(await webhook(p.ref, p.amount)).toBe("already_paid");
    expect(await count("select count(*) as n from public.subscription_periods where payment_id = $1", [p.id])).toBe(1);
    expect(await count("select count(*) as n from public.subscription_receipts where payment_id = $1", [p.id])).toBe(1);
  });

  it("concurrent deliveries of different events still apply once", async () => {
    const p = await gatewayPayment(small);
    const results = await Promise.all(Array.from({ length: 5 }, () => webhook(p.ref, p.amount)));
    expect(results.filter((r) => r === "applied")).toHaveLength(1);
    expect(
      await count("select count(*) as n from public.subscription_periods where clinic_id = $1", [f.clinicId]),
    ).toBe(1);
  });

  it("a wrong amount, a failure or an unknown reference grants nothing", async () => {
    const p = await gatewayPayment(small);
    expect(await webhook(p.ref, p.amount - 1)).toBe("amount_mismatch");
    expect(await webhook("ref_unknown", p.amount)).toBe("unknown_payment");
    expect(await webhook(p.ref, p.amount, randomUUID(), "failed")).toBe("failed");
    expect(await webhook(p.ref, p.amount)).toBe("invalid_state");
    expect(
      await count("select count(*) as n from public.subscription_periods where clinic_id = $1", [f.clinicId]),
    ).toBe(0);
  });

  it("webhook processing is service-role only", async () => {
    await asUser(f.owner, (db) =>
      expectPgError(
        db.query("select public.process_payment_webhook('mockpay', 'e', 'r', 'paid', 1)"),
        /permission denied/,
      ),
    );
  });
});

describe("manual payments (SUB-006, scenario 12)", () => {
  it("evidence alone never activates; admin verification does, once", async () => {
    await endTrial(30);
    const id = await manualPayment(small);
    expect((await status()).state).toBe("restricted");
    await asUser(f.owner, (db) =>
      expectPgError(db.query("select public.admin_decide_manual_payment($1, true, null)", [id]), /forbidden/),
    );
    await q(admin, "select public.admin_decide_manual_payment($1, true, null) as r", [id]);
    expect((await status()).state).toBe("active");
    await asUser(admin, (db) =>
      expectPgError(db.query("select public.admin_decide_manual_payment($1, true, null)", [id]), /invalid_transition/),
    );
    expect(await count("select count(*) as n from public.subscription_receipts where payment_id = $1", [id])).toBe(1);
  });

  it("rejection needs a reason and grants nothing", async () => {
    const id = await manualPayment(small);
    await asUser(admin, (db) =>
      expectPgError(db.query("select public.admin_decide_manual_payment($1, false, ' ')", [id]), /reason_required/),
    );
    await q(admin, "select public.admin_decide_manual_payment($1, false, 'Synthetic: unreadable') as r", [id]);
    expect(
      await count("select count(*) as n from public.subscription_periods where clinic_id = $1", [f.clinicId]),
    ).toBe(0);
  });

  it("evidence must be in the clinic's own folder", async () => {
    const other = await setupClinic();
    const path = `${other.clinicId}/${randomUUID()}.pdf`;
    await putStorageObject("billing-evidence", path);
    await asUser(f.owner, (db) =>
      expectPgError(
        db.query(
          "select public.submit_manual_payment($1, $2, 'monthly', 0, 'instapay', 'X', $3, 'application/pdf', 10)",
          [f.clinicId, small, path],
        ),
        /invalid_storage_path/,
      ),
    );
    await asUser(f.owner, (db) =>
      expectPgError(
        db.query("insert into storage.objects (bucket_id, name) values ('billing-evidence', $1)", [path]),
        /row-level security/,
      ),
    );
  });

  it("only the owner and platform admins see SaaS payments; admin evidence access is audited", async () => {
    const id = await manualPayment(small);
    for (const user of [f.manager, f.cashier, f.receptionist]) {
      await asUser(user, async (db) => {
        expect(
          (await db.query("select id from public.subscription_payments where clinic_id = $1", [f.clinicId])).rows,
        ).toHaveLength(0);
      });
    }
    await asUser(admin, async (db) => {
      expect((await db.query("select id from public.subscription_payments where id = $1", [id])).rows).toHaveLength(1);
      await expectPgError(db.query("select evidence_path from public.subscription_payments"), /permission denied/);
    });
    await q(admin, "select public.admin_record_payment_evidence_access($1) as r", [id]);
    expect(
      await count(
        "select count(*) as n from public.audit_events where action = 'payment.evidence_viewed' and resource_id = $1",
        [id],
      ),
    ).toBe(1);
  });
});

describe("renewals and plan changes (SUB-008, scenario 11)", () => {
  it("paying during the trial starts the period when the trial ends", async () => {
    const p = await gatewayPayment(small);
    await webhook(p.ref, p.amount);
    const s = await status();
    expect(s.state).toBe("trial");
    expect(s.doctor_capacity).toBe(3);
    const { rows } = await adminPool().query(
      "select p.period_start = s.trial_ends_at as aligned from public.subscription_periods p join public.clinic_subscriptions s using (clinic_id) where p.payment_id = $1",
      [p.id],
    );
    expect(rows[0].aligned).toBe(true);
  });

  it("an upgrade paid mid-period takes effect only at the next renewal", async () => {
    await endTrial();
    const first = await gatewayPayment(small);
    await webhook(first.ref, first.amount);
    const second = await gatewayPayment(large);
    await webhook(second.ref, second.amount);
    const s = await status();
    expect(s.state).toBe("active");
    expect(s.plan_version_id).toBe(small);
    expect(s.doctor_capacity).toBe(2);
    expect(s.next_period_start?.toISOString()).toBe(s.period_end?.toISOString());
  });

  it("parallel renewals never produce overlapping periods", async () => {
    await endTrial();
    const a = await gatewayPayment(small);
    const b = await gatewayPayment(small);
    await Promise.all([webhook(a.ref, a.amount), webhook(b.ref, b.amount)]);
    const { rows } = await adminPool().query(
      "select period_start, period_end from public.subscription_periods where clinic_id = $1 order by period_start",
      [f.clinicId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].period_start.toISOString()).toBe(rows[0].period_end.toISOString());
  });
});

describe("doctor capacity (SUB-002)", () => {
  async function ownerMembership() {
    return (
      await adminPool().query("select id from public.clinic_memberships where clinic_id = $1 and user_id = $2", [
        f.clinicId,
        f.owner,
      ])
    ).rows[0].id as string;
  }

  it("doctors beyond capacity are added inactive and cannot be activated", async () => {
    await endTrial();
    const p = await gatewayPayment(small); // 2 doctors; the fixture already has 2 active
    await webhook(p.ref, p.amount);
    const id = await q(f.owner, "select public.add_clinic_doctor($1, 'Synthetic Owner Doctor', null) as r", [
      await ownerMembership(),
    ]);
    const { rows } = await adminPool().query("select status from public.clinic_doctors where id = $1", [id]);
    expect(rows[0].status).toBe("inactive");
    await asUser(f.owner, (db) =>
      expectPgError(db.query("select public.set_clinic_doctor_status($1, 'active')", [id]), /doctor_capacity_reached/),
    );
    await q(f.owner, "select public.set_clinic_doctor_status($1, 'inactive') as r", [f.otherDoctorId]);
    await q(f.owner, "select public.set_clinic_doctor_status($1, 'active') as r", [id]);
  });

  it("two concurrent activations cannot both take the last slot", async () => {
    await endTrial();
    const p = await gatewayPayment(small);
    await webhook(p.ref, p.amount);
    await q(f.owner, "select public.set_clinic_doctor_status($1, 'inactive') as r", [f.otherDoctorId]);
    const extraUser = await createUser("m6-doctor");
    await adminPool().query(
      "insert into public.clinic_memberships (clinic_id, user_id, role) values ($1, $2, 'doctor')",
      [f.clinicId, extraUser],
    );
    const third = await addDoctor(f.clinicId, extraUser, "Synthetic Dr. Three");
    await adminPool().query("update public.clinic_doctors set status = 'inactive' where id = $1", [third]);
    const results = await Promise.allSettled(
      [f.otherDoctorId, third].map((id) =>
        q(f.owner, "select public.set_clinic_doctor_status($1, 'active') as r", [id]),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await count("select count(*) as n from public.clinic_doctors where clinic_id = $1 and status = 'active'", [
        f.clinicId,
      ]),
    ).toBe(2);
  });
});

describe("expiry, grace and restricted mode (SUB-004)", () => {
  let session: string;
  let patient: string;

  beforeEach(async () => {
    await setPolicy(f.clinicId, f.doctorId, f.owner, { method: "queue" });
    session = await createSession(f, f.doctorId, { method: "queue", capacity: 5, daysFromToday: 1 });
    patient = await createPatient(f.clinicId, f.owner);
  });

  const book = (user = f.receptionist) =>
    asUser(user, (db) => db.query("select public.book_appointment($1, $2, null, false, null)", [session, patient]));

  it("grace keeps the clinic working", async () => {
    await endTrial(3);
    expect((await status()).state).toBe("grace");
    await book();
  });

  it("after grace, growth stops but records stay readable and nothing is erased", async () => {
    await asUserCommitted(f.receptionist, (db) =>
      db.query("select public.book_appointment($1, $2, null, false, null)", [session, patient]),
    );
    await endTrial(30);
    expect((await status()).state).toBe("restricted");
    const second = await createPatient(f.clinicId, f.owner, "Synthetic Second");
    await asUser(f.receptionist, (db) =>
      expectPgError(
        db.query("select public.book_appointment($1, $2, null, false, null)", [session, second]),
        /subscription_restricted/,
      ),
    );
    await adminPool().query("update public.clinics set online_booking_enabled = true where id = $1", [f.clinicId]);
    await asCommitted("service_role", null, (db) =>
      expectPgError(
        db.query("select public.public_submit_booking_request($1, $2, null, 'Synthetic', '+201000000099', false)", [
          f.clinicId,
          session,
        ]),
        /subscription_restricted/,
      ),
    );
    await asUser(f.receptionist, async (db) => {
      const { rows } = await db.query("select id from public.appointments where clinic_id = $1", [f.clinicId]);
      expect(rows).toHaveLength(1);
    });
    // The clinic can still pay to recover.
    await gatewayPayment(small);
  });

  it("a trial extension by a platform admin lifts the restriction and is recorded", async () => {
    await endTrial(30);
    await asUser(f.owner, (db) =>
      expectPgError(db.query("select public.admin_extend_trial($1, 7, 'x')", [f.clinicId]), /forbidden/),
    );
    await asUser(admin, (db) =>
      expectPgError(db.query("select public.admin_extend_trial($1, 7, '')", [f.clinicId]), /reason_required/),
    );
    await q(admin, "select public.admin_extend_trial($1, 7, 'Synthetic onboarding delay') as r", [f.clinicId]);
    expect((await status()).state).toBe("trial");
    await book();
    expect(await count("select count(*) as n from public.trial_extensions where clinic_id = $1", [f.clinicId])).toBe(1);
  });
});

describe("licence re-verification (ONB-006)", () => {
  async function upload(type = "clinic_operating") {
    const path = `${f.clinicId}/${type}/${randomUUID()}.pdf`;
    await putStorageObject("licenses", path);
    return (await q(f.owner, "select public.submit_clinic_license($1, $2, $3, 'application/pdf', 1000) as r", [
      f.clinicId,
      type,
      path,
    ])) as string;
  }

  it("an active clinic keeps its approved licence until a newer revision is approved", async () => {
    const first = await upload();
    await q(admin, "select public.admin_review_license($1, 'approved', null) as r", [first]);
    await q(
      admin,
      "select public.admin_request_license_reverification($1, 'clinic_operating', 'Synthetic expiry') as r",
      [f.clinicId],
    );
    await asUser(admin, (db) =>
      expectPgError(
        db.query("select public.admin_request_license_reverification($1, 'clinic_operating', 'again')", [f.clinicId]),
        /request_pending/,
      ),
    );
    const second = await upload();
    const statusOf = async (id: string) =>
      (await adminPool().query("select review_status from public.clinic_licenses where id = $1", [id])).rows[0]
        .review_status;
    expect(await statusOf(first)).toBe("approved");
    expect(
      await count(
        "select count(*) as n from public.license_reverification_requests where clinic_id = $1 and fulfilled_at is null",
        [f.clinicId],
      ),
    ).toBe(0);
    await q(admin, "select public.admin_review_license($1, 'approved', null) as r", [second]);
    expect(await statusOf(first)).toBe("superseded");
    expect(await statusOf(second)).toBe("approved");
  });
});

describe("closure keeps archives (scenario 13)", () => {
  it("closing a clinic erases nothing and the owner's export stays controlled and audited", async () => {
    const patient = await createPatient(f.clinicId, f.owner);
    await q(admin, "select public.admin_set_clinic_state($1, 'closed', 'Synthetic exit') as r", [f.clinicId]);
    expect(await count("select count(*) as n from public.clinic_patients where id = $1", [patient])).toBe(1);
    await q(f.owner, "select count(*) as r from public.finance_export($1, current_date - 30, current_date)", [
      f.clinicId,
    ]);
    expect(
      await count(
        "select count(*) as n from public.audit_events where clinic_id = $1 and action = 'export.requested'",
        [f.clinicId],
      ),
    ).toBeGreaterThanOrEqual(1);
    await asUser(f.receptionist, (db) =>
      expectPgError(
        db.query("select * from public.finance_export($1, current_date - 30, current_date)", [f.clinicId]),
        /forbidden/,
      ),
    );
    await asUser(admin, (db) =>
      expectPgError(
        db.query("select * from public.finance_export($1, current_date - 30, current_date)", [f.clinicId]),
        /forbidden/,
      ),
    );
  });
});
