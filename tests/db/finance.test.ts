// Operational finance. SRS FIN-001..015, invariant 6, acceptance scenarios 6
// (reversal/refund reconciliation) and 7 (handover and immutable counts).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminPool, asUser, asUserCommitted, closePool, createUser, expectPgError, makePlatformAdmin } from "./helpers";
import { createPatient, setupClinic, type ClinicFixture } from "./fixtures";

afterAll(closePool);

let f: ClinicFixture;
let drawer: string;
let safe: string;
let bank: string;
let pos: string;

const q = (user: string, sql: string, params: unknown[] = []) =>
  asUserCommitted(user, async (db) => (await db.query(sql, params)).rows[0]?.r);

async function account(name: string, type: string, opening = 0) {
  const id = await q(f.owner, "select public.create_financial_account($1, $2, $3) as r", [f.clinicId, name, type]);
  const req = await q(f.owner, "select public.submit_opening_balance($1, $2) as r", [id, opening]);
  await q(f.owner, "select public.decide_opening_balance($1, true) as r", [req]);
  return id as string;
}

async function setPolicies(overrides: Record<string, unknown> = {}) {
  const p = {
    expense: "direct",
    expenseT: null,
    transfer: "direct",
    transferT: null,
    refund: "direct",
    refundT: null,
    discrepancy: "warning",
    daily: "daily_close_required",
    ...overrides,
  };
  await q(f.owner, "select public.set_finance_policies($1, $2, $3, $4, $5, $6, $7, $8, $9) as r", [
    f.clinicId,
    p.expense,
    p.expenseT,
    p.transfer,
    p.transferT,
    p.refund,
    p.refundT,
    p.discrepancy,
    p.daily,
  ]);
}

const balance = async (accountId: string) =>
  Number((await adminPool().query("select private.account_balance($1) as b", [accountId])).rows[0].b);

const revenue = async () =>
  Number(
    (
      await adminPool().query(
        "select coalesce(sum(credit_minor - debit_minor), 0) as r from public.journal_entries where clinic_id = $1 and nominal = 'revenue'",
        [f.clinicId],
      )
    ).rows[0].r,
  );

const openSession = (user = f.cashier, opening = 10_000) =>
  q(user, "select public.open_cashier_session($1, $2) as r", [drawer, opening]);

const pay = (
  amount: number,
  method = "cash",
  target = drawer,
  reference: string | null = null,
  corrects: string | null = null,
  user = f.cashier,
) =>
  q(user, "select public.record_payment($1, $2, $3, $4, $5, null, null, $6) as r", [
    f.clinicId,
    target,
    amount,
    method,
    reference,
    corrects,
  ]);

beforeEach(async () => {
  f = await setupClinic();
  drawer = await account("Synthetic drawer", "cash_drawer");
  safe = await account("Synthetic safe", "safe", 50_000);
  bank = await account("Synthetic bank", "bank");
  pos = await account("Synthetic POS", "pos");
  await setPolicies();
});

describe("accounts and opening balances (FIN-002/003)", () => {
  it("opening balance needs owner approval and is not revenue", async () => {
    expect(await balance(safe)).toBe(50_000);
    expect(await revenue()).toBe(0);
    const pending = await q(f.owner, "select public.create_financial_account($1, 'Synthetic wallet', 'wallet') as r", [
      f.clinicId,
    ]);
    await q(f.owner, "select public.set_role_permission($1, 'manager', 'finance.accounts', true) as r", [f.clinicId]);
    const req = await q(f.manager, "select public.submit_opening_balance($1, 700) as r", [pending]);
    await asUser(f.manager, (db) =>
      expectPgError(db.query("select public.decide_opening_balance($1, true)", [req]), /forbidden/),
    );
  });

  it("an account cannot be used before its opening balance is approved", async () => {
    const pending = await q(
      f.owner,
      "select public.create_financial_account($1, 'Synthetic drawer 2', 'cash_drawer') as r",
      [f.clinicId],
    );
    await asUser(f.cashier, (db) =>
      expectPgError(db.query("select public.open_cashier_session($1, 0)", [pending]), /account_not_active/),
    );
  });
});

describe("payments and the ledger (FIN-001, FIN-015, invariant 6)", () => {
  it("requires an open cashier session and a matching account", async () => {
    await expectPgError(pay(1000), /no_open_session/);
    await openSession();
    await expectPgError(pay(1000, "cash", bank), /method_account_mismatch/);
    await expectPgError(pay(1000, "pos", pos, null), /reference_required/);
    await pay(1000, "pos", pos, "RRN-1");
    await pay(2500);
    expect(await revenue()).toBe(3500);
  });

  it("every transaction is balanced and immutable, even for the table owner", async () => {
    await openSession();
    const txn = await pay(1500);
    const { rows } = await adminPool().query(
      "select sum(debit_minor)::int as d, sum(credit_minor)::int as c from public.journal_entries where transaction_id = $1",
      [txn],
    );
    expect(rows[0]).toEqual({ d: 1500, c: 1500 });
    await expectPgError(
      adminPool().query("update public.financial_transactions set amount_minor = 1 where id = $1", [txn]),
      /append-only/,
    );
    await expectPgError(
      adminPool().query("delete from public.journal_entries where transaction_id = $1", [txn]),
      /append-only/,
    );
  });

  it("an unbalanced journal is rejected at commit", async () => {
    const client = await adminPool().connect();
    try {
      await client.query("begin");
      const { rows } = await client.query(
        "insert into public.financial_transactions (clinic_id, kind, amount_minor, method, business_date) values ($1, 'payment', 100, 'cash', current_date) returning id",
        [f.clinicId],
      );
      await client.query(
        "insert into public.journal_entries (clinic_id, transaction_id, financial_account_id, debit_minor) values ($1, $2, $3, 100)",
        [f.clinicId, rows[0].id, drawer],
      );
      await expectPgError(client.query("commit"), /unbalanced/);
    } finally {
      await client.query("rollback").catch(() => null);
      client.release();
    }
  });

  it("only granted staff can post; platform admins and other clinics see nothing", async () => {
    await asUser(f.receptionist, (db) =>
      expectPgError(db.query("select public.open_cashier_session($1, 0)", [drawer]), /forbidden/),
    );
    await q(f.owner, "select public.set_role_permission($1, 'receptionist', 'finance.collect', true) as r", [
      f.clinicId,
    ]);
    await q(f.receptionist, "select public.open_cashier_session($1, 0) as r", [drawer]);

    const admin = await createUser("fin-admin");
    await makePlatformAdmin(admin);
    const other = await setupClinic();
    for (const user of [admin, other.owner, f.doctorUser]) {
      const seen = await asUser(user, async (db) => ({
        txns: (await db.query("select 1 from public.financial_transactions where clinic_id = $1", [f.clinicId]))
          .rowCount,
        accounts: (await db.query("select 1 from public.financial_accounts where clinic_id = $1", [f.clinicId]))
          .rowCount,
      }));
      expect(seen, user).toEqual({ txns: 0, accounts: 0 });
      await asUser(user, (db) =>
        expectPgError(
          db.query("select public.finance_report($1, current_date, current_date)", [f.clinicId]),
          /forbidden/,
        ),
      );
    }
  });
});

describe("expenses, transfers and approval policies (FIN-006/007)", () => {
  it("threshold policy: small amounts post directly, large ones wait for approval", async () => {
    await setPolicies({ expense: "threshold", expenseT: 5000 });
    await openSession();
    const small = await q(
      f.cashier,
      "select public.submit_finance_request($1, 'expense', 3000, $2, null, null, 'Supplies', null) as r",
      [f.clinicId, drawer],
    );
    expect(small.needs_approval).toBe(false);
    const big = await q(
      f.cashier,
      "select public.submit_finance_request($1, 'expense', 9000, $2, null, null, 'Equipment', null) as r",
      [f.clinicId, safe],
    );
    expect(big).toMatchObject({ needs_approval: true, transaction_id: null });
    await asUser(f.cashier, (db) =>
      expectPgError(db.query("select public.decide_finance_request($1, true, null)", [big.request_id]), /forbidden/),
    );
    await q(f.owner, "select public.decide_finance_request($1, true, null) as r", [big.request_id]);
    expect(await balance(safe)).toBe(41_000);
    expect(await revenue()).toBe(0);
  });

  it("transfers and POS settlement move money without creating revenue", async () => {
    await openSession();
    await pay(4000, "pos", pos, "RRN-2");
    await q(
      f.cashier,
      "select public.submit_finance_request($1, 'transfer', 4000, $2, $3, null, null, 'POS settlement') as r",
      [f.clinicId, pos, bank],
    );
    expect([await balance(pos), await balance(bank), await revenue()]).toEqual([0, 4000, 4000]);
  });

  it("an approver cannot approve their own request (except the owner)", async () => {
    await setPolicies({ transfer: "all_approval" });
    await q(f.owner, "select public.set_role_permission($1, 'manager', 'finance.approve', true) as r", [f.clinicId]);
    await q(f.owner, "select public.set_role_permission($1, 'manager', 'finance.collect', true) as r", [f.clinicId]);
    const req = await q(
      f.manager,
      "select public.submit_finance_request($1, 'transfer', 100, $2, $3, null, null, null) as r",
      [f.clinicId, safe, bank],
    );
    await asUser(f.manager, (db) =>
      expectPgError(
        db.query("select public.decide_finance_request($1, true, null)", [req.request_id]),
        /cannot_approve_own/,
      ),
    );
  });
});

describe("refunds, reversals and corrections (FIN-008/009, acceptance 6)", () => {
  it("full refund only, linked to the payment, once", async () => {
    await openSession();
    const payment = await pay(6000);
    await expect(
      q(f.cashier, "select public.submit_finance_request($1, 'refund', 3000, $2, null, $3, null, 'partial') as r", [
        f.clinicId,
        drawer,
        payment,
      ]),
    ).rejects.toThrow(/full_refund_only/);
    await expect(
      q(f.cashier, "select public.submit_finance_request($1, 'refund', 6000, $2, null, $3, null, '') as r", [
        f.clinicId,
        drawer,
        payment,
      ]),
    ).rejects.toThrow(/reason_required/);
    const refund = await q(
      f.cashier,
      "select public.submit_finance_request($1, 'refund', 6000, $2, null, $3, null, 'Synthetic: visit cancelled') as r",
      [f.clinicId, drawer, payment],
    );
    const { rows } = await adminPool().query(
      "select refund_of_transaction_id from public.financial_transactions where id = $1",
      [refund.transaction_id],
    );
    expect(rows[0].refund_of_transaction_id).toBe(payment);
    await expect(
      q(f.cashier, "select public.submit_finance_request($1, 'refund', 6000, $2, null, $3, null, 'again') as r", [
        f.clinicId,
        drawer,
        payment,
      ]),
    ).rejects.toThrow(/already_refunded_or_reversed/);
  });

  it("reversal plus corrected entry reconciles balances and revenue without touching the original", async () => {
    await openSession();
    const wrong = await pay(5000);
    await expectPgError(pay(4500, "cash", drawer, null, wrong), /correct_requires_reversal/);
    await asUser(f.cashier, (db) =>
      expectPgError(db.query("select public.reverse_transaction($1, 'typo')", [wrong]), /forbidden/),
    );
    await q(f.owner, "select public.reverse_transaction($1, 'Synthetic: wrong amount') as r", [wrong]);
    const corrected = await pay(4500, "cash", drawer, null, wrong);

    expect(await revenue()).toBe(4500);
    expect(await balance(drawer)).toBe(4500);
    const original = await adminPool().query("select amount_minor from public.financial_transactions where id = $1", [
      wrong,
    ]);
    expect(Number(original.rows[0].amount_minor)).toBe(5000);
    const link = await adminPool().query(
      "select corrects_transaction_id from public.financial_transactions where id = $1",
      [corrected],
    );
    expect(link.rows[0].corrects_transaction_id).toBe(wrong);
    await expect(q(f.owner, "select public.reverse_transaction($1, 'again') as r", [wrong])).rejects.toThrow(
      /already_refunded_or_reversed/,
    );

    const report = await q(f.owner, "select public.finance_report($1, current_date - 1, current_date + 1) as r", [
      f.clinicId,
    ]);
    expect(report.by_method.cash).toBe(4500);
  });
});

describe("cashier sessions and handovers (FIN-004/005, acceptance 7)", () => {
  it("computes expected cash and preserves the count and discrepancy", async () => {
    await setPolicies({ discrepancy: "explanation_required" });
    const session = await openSession(f.cashier, 10_000);
    await pay(3000);
    await q(f.cashier, "select public.submit_finance_request($1, 'expense', 500, $2, null, null, 'Water', null) as r", [
      f.clinicId,
      drawer,
    ]);
    await expect(
      q(f.cashier, "select public.close_cashier_session(12000, null, $1) as r", [f.clinicId]),
    ).rejects.toThrow(/explanation_required/);
    const result = await q(f.cashier, "select public.close_cashier_session(12000, 'Synthetic: short', $1) as r", [
      f.clinicId,
    ]);
    expect(result).toEqual({ expected_minor: 12_500, discrepancy_minor: -500, status: "closed" });
    await expectPgError(
      adminPool().query("update public.cashier_sessions set counted_minor = 12500 where id = $1", [session]),
      /immutable/,
    );
  });

  it("approval policy: a discrepancy waits for someone other than the cashier", async () => {
    await setPolicies({ discrepancy: "approval_required" });
    const session = await openSession(f.cashier, 0);
    const result = await q(f.cashier, "select public.close_cashier_session(100, 'found extra', $1) as r", [f.clinicId]);
    expect(result.status).toBe("pending_approval");
    await q(f.owner, "select public.approve_cashier_session($1) as r", [session]);
  });

  it("handover posts only on the recipient's acknowledgement, exactly once under concurrency", async () => {
    const session = await openSession(f.cashier, 0);
    await pay(8000);
    await q(f.cashier, "select public.close_cashier_session(8000, null, $1) as r", [f.clinicId]);
    const handover = await q(f.cashier, "select public.create_cash_handover($1, $2, $3, 8000) as r", [
      session,
      f.owner,
      safe,
    ]);
    expect(await balance(safe)).toBe(50_000);
    await asUser(f.manager, (db) =>
      expectPgError(db.query("select public.acknowledge_cash_handover($1)", [handover]), /forbidden/),
    );

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => q(f.owner, "select public.acknowledge_cash_handover($1) as r", [handover])),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect([await balance(safe), await balance(drawer)]).toEqual([58_000, 0]);
  });

  it("concurrent handovers from one session are all kept (no overwrite)", async () => {
    const session = await openSession(f.cashier, 0);
    await pay(9000);
    await q(f.cashier, "select public.close_cashier_session(9000, null, $1) as r", [f.clinicId]);
    await Promise.all(
      [3000, 3000, 3000].map((amount, i) =>
        q(f.cashier, "select public.create_cash_handover($1, $2, $3, $4) as r", [
          session,
          i % 2 ? f.owner : f.manager,
          safe,
          amount,
        ]),
      ),
    );
    const { rows } = await adminPool().query(
      "select count(*)::int as n from public.cash_handovers where cashier_session_id = $1",
      [session],
    );
    expect(rows[0].n).toBe(3);
  });
});

describe("daily closing and reports (FIN-012/013)", () => {
  it("daily close requires closed sessions and snapshots totals", async () => {
    await openSession();
    await pay(2000);
    await expect(
      q(f.cashier, "select public.submit_daily_close($1, (now() at time zone 'Africa/Cairo')::date) as r", [
        f.clinicId,
      ]),
    ).rejects.toThrow(/sessions_not_closed/);
    await q(f.cashier, "select public.close_cashier_session(12000, null, $1) as r", [f.clinicId]);
    expect(
      await q(f.cashier, "select public.submit_daily_close($1, (now() at time zone 'Africa/Cairo')::date) as r", [
        f.clinicId,
      ]),
    ).toBe("approved");
  });

  it("reported balances reconcile with the journal", async () => {
    const patient = await createPatient(f.clinicId, f.receptionist);
    void patient;
    await openSession();
    await pay(1000);
    await pay(2000, "pos", pos, "RRN-3");
    const report = await q(f.owner, "select public.finance_report($1, current_date - 1, current_date + 1) as r", [
      f.clinicId,
    ]);
    for (const row of report.balances as { account: string; balance_minor: number }[]) {
      const id = { "Synthetic drawer": drawer, "Synthetic safe": safe, "Synthetic bank": bank, "Synthetic POS": pos }[
        row.account
      ];
      if (id) expect(row.balance_minor, row.account).toBe(await balance(id));
    }
    const { rows } = await adminPool().query(
      "select sum(debit_minor) = sum(credit_minor) as ok from public.journal_entries where clinic_id = $1",
      [f.clinicId],
    );
    expect(rows[0].ok).toBe(true);
  });
});

describe("finance helpers", () => {
  it("cashiers resolve patients and recipients without registry access; others cannot", async () => {
    const patient = await createPatient(f.clinicId, f.receptionist, "Synthetic Payer");
    const { rows } = await adminPool().query("select chart_number from public.clinic_patients where id = $1", [
      patient,
    ]);
    const found = await q(f.cashier, "select to_jsonb(p) as r from public.finance_find_patient($1, $2) p", [
      f.clinicId,
      rows[0].chart_number,
    ]);
    expect(found).toEqual({ clinic_patient_id: patient, full_name: "Synthetic Payer" });
    await asUser(f.doctorUser, (db) =>
      expectPgError(db.query("select * from public.finance_find_patient($1, 1)", [f.clinicId]), /forbidden/),
    );
    const recipients = await asUser(f.cashier, async (db) =>
      (await db.query("select user_id from public.finance_handover_recipients($1)", [f.clinicId])).rows.map(
        (r) => r.user_id,
      ),
    );
    expect(recipients).toEqual([f.owner]);
  });

  it("receipts are available to the poster and approvers only", async () => {
    await openSession();
    const txn = await pay(1234);
    const receipt = await q(f.cashier, "select public.finance_receipt($1) as r", [txn]);
    expect(receipt).toMatchObject({ amount_minor: 1234, kind: "payment", reversed: false });
    await asUser(f.receptionist, (db) =>
      expectPgError(db.query("select public.finance_receipt($1)", [txn]), /forbidden/),
    );
  });
});
