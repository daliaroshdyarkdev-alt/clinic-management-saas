import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const accountSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  account_type: z.enum(["cash_drawer", "safe", "bank", "pos", "wallet"]),
  status: z.enum(["pending_opening", "active", "closed"]),
});
export type FinancialAccount = z.infer<typeof accountSchema>;

export async function getAccounts(clinicId: string): Promise<FinancialAccount[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("financial_accounts")
    .select("id, name, account_type, status")
    .eq("clinic_id", clinicId)
    .order("name");
  if (error) throw new Error("Failed to load accounts");
  return z.array(accountSchema).parse(data);
}

const sessionSchema = z.object({
  id: z.uuid(),
  cash_account_id: z.uuid(),
  status: z.enum(["open", "pending_approval", "closed"]),
  opened_at: z.string(),
  opening_count_minor: z.coerce.number(),
  counted_minor: z.coerce.number().nullable(),
  expected_minor: z.coerce.number().nullable(),
  discrepancy_minor: z.coerce.number().nullable(),
  explanation: z.string().nullable(),
  cashier_user_id: z.uuid(),
});
export type CashierSession = z.infer<typeof sessionSchema>;

const SESSION_SELECT =
  "id, cash_account_id, status, opened_at, opening_count_minor, counted_minor, expected_minor, discrepancy_minor, explanation, cashier_user_id";

export async function getMySessions(clinicId: string, userId: string): Promise<CashierSession[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("cashier_sessions")
    .select(SESSION_SELECT)
    .eq("clinic_id", clinicId)
    .eq("cashier_user_id", userId)
    .order("opened_at", { ascending: false })
    .limit(5);
  if (error) throw new Error("Failed to load sessions");
  return z.array(sessionSchema).parse(data);
}

export async function getSessionsPendingApproval(clinicId: string): Promise<CashierSession[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("cashier_sessions")
    .select(SESSION_SELECT)
    .eq("clinic_id", clinicId)
    .eq("status", "pending_approval");
  if (error) throw new Error("Failed to load sessions");
  return z.array(sessionSchema).parse(data);
}

const txnSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["opening_balance", "payment", "refund", "expense", "transfer", "reversal"]),
  amount_minor: z.coerce.number(),
  method: z.enum(["cash", "pos", "instapay", "bank_transfer"]).nullable(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  posted_at: z.string(),
  business_date: z.string(),
  reverses_transaction_id: z.uuid().nullable(),
  refund_of_transaction_id: z.uuid().nullable(),
  corrects_transaction_id: z.uuid().nullable(),
});
export type FinancialTransaction = z.infer<typeof txnSchema>;

const TXN_SELECT =
  "id, kind, amount_minor, method, reference, description, category, posted_at, business_date, reverses_transaction_id, refund_of_transaction_id, corrects_transaction_id";

/** Posted transactions visible to the caller (RLS: reports/approvers all, collectors their own). */
export async function getTransactions(clinicId: string, from: string, to: string): Promise<FinancialTransaction[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("financial_transactions")
    .select(TXN_SELECT)
    .eq("clinic_id", clinicId)
    .gte("business_date", from)
    .lte("business_date", to)
    .order("posted_at", { ascending: false })
    .limit(300);
  if (error) throw new Error("Failed to load transactions");
  return z.array(txnSchema).parse(data);
}

export async function getTransaction(id: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("financial_transactions")
    .select(`${TXN_SELECT}, clinic_patient_id, clinic_id`)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return txnSchema.extend({ clinic_patient_id: z.uuid().nullable(), clinic_id: z.uuid() }).parse(data);
}

const requestSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["expense", "transfer", "refund"]),
  amount_minor: z.coerce.number(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  status: z.enum(["submitted", "approved", "rejected"]),
  submitted_at: z.string(),
  submitted_by: z.uuid(),
});

export async function getOpenRequests(clinicId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("finance_requests")
    .select("id, kind, amount_minor, category, description, status, submitted_at, submitted_by")
    .eq("clinic_id", clinicId)
    .eq("status", "submitted")
    .order("submitted_at");
  if (error) throw new Error("Failed to load requests");
  return z.array(requestSchema).parse(data);
}

export async function getPendingOpeningBalances(clinicId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("opening_balance_requests")
    .select("id, account_id, amount_minor")
    .eq("clinic_id", clinicId)
    .eq("status", "submitted");
  if (error) throw new Error("Failed to load opening balances");
  return z.array(z.object({ id: z.uuid(), account_id: z.uuid(), amount_minor: z.coerce.number() })).parse(data);
}

const handoverSchema = z.object({
  id: z.uuid(),
  amount_minor: z.coerce.number(),
  from_user_id: z.uuid(),
  to_user_id: z.uuid(),
  created_at: z.string(),
  acknowledged_at: z.string().nullable(),
});

export async function getHandovers(clinicId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("cash_handovers")
    .select("id, amount_minor, from_user_id, to_user_id, created_at, acknowledged_at")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error("Failed to load handovers");
  return z.array(handoverSchema).parse(data);
}

export async function getPolicies(clinicId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("finance_policies")
    .select(
      "expense_policy, expense_threshold_minor, transfer_policy, transfer_threshold_minor, refund_policy, refund_threshold_minor, discrepancy_policy, daily_closing_policy",
    )
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) throw new Error("Failed to load policies");
  return data;
}

export async function getDailyClosings(clinicId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("daily_financial_closings")
    .select("business_date, status, totals")
    .eq("clinic_id", clinicId)
    .order("business_date", { ascending: false })
    .limit(14);
  if (error) throw new Error("Failed to load closings");
  return z
    .array(
      z.object({
        business_date: z.string(),
        status: z.enum(["submitted", "approved"]),
        totals: z.record(z.string(), z.number()),
      }),
    )
    .parse(data);
}

const reportSchema = z.object({
  by_day: z.array(z.object({ date: z.string(), totals: z.record(z.string(), z.number()) })),
  by_method: z.record(z.string(), z.number()),
  by_doctor: z.array(z.object({ doctor: z.string(), collections_minor: z.number() })),
  expenses_by_category: z.record(z.string(), z.number()),
  balances: z.array(z.object({ account: z.string(), type: z.string(), status: z.string(), balance_minor: z.number() })),
  cashier_sessions: z.array(
    z.object({
      opened_at: z.string(),
      status: z.string(),
      expected_minor: z.number().nullable(),
      counted_minor: z.number().nullable(),
      discrepancy_minor: z.number().nullable(),
      cashier: z.string().nullable(),
    }),
  ),
  employee_activity: z.array(z.object({ name: z.string().nullable(), transactions: z.number() })),
  monthly: z.array(z.object({ month: z.string(), totals: z.record(z.string(), z.number()) })),
});
export type FinanceReport = z.infer<typeof reportSchema>;

export async function getReport(clinicId: string, from: string, to: string): Promise<FinanceReport | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("finance_report", { p_clinic_id: clinicId, p_from: from, p_to: to });
  if (error) return null;
  return reportSchema.parse(data);
}

/** Names of clinic members for handover recipients (RLS-limited to what the caller may see). */
export async function getMemberNames(clinicId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("finance_handover_recipients", { p_clinic_id: clinicId });
  return z
    .array(z.object({ user_id: z.uuid(), full_name: z.string() }))
    .catch([])
    .parse(data ?? []);
}
