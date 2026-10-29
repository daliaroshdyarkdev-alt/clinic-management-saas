"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { localeFrom } from "@/lib/locale-input";
import { parseEgpToMinor } from "@/lib/money";
import type { ActionState } from "@/modules/shared/form-state";
import { callRpc } from "@/modules/shared/rpc";
import { getWorkspace } from "@/modules/tenancy/workspace";

async function clinicId() {
  return (await getWorkspace())?.active?.clinicId ?? null;
}

function refresh(locale: string) {
  revalidatePath(`/${locale}/app/finance`, "layout");
}

const amountFrom = (formData: FormData, name = "amount") => parseEgpToMinor(String(formData.get(name) ?? ""));

export async function openSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const accountId = z.uuid().safeParse(formData.get("accountId"));
  const amount = amountFrom(formData, "openingCount");
  if (!accountId.success || amount === null) return { error: "invalid_amount" };
  const result = await callRpc("open_cashier_session", { p_account_id: accountId.data, p_opening_count_minor: amount });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function closeSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const id = await clinicId();
  const counted = amountFrom(formData, "counted");
  if (!id || counted === null) return { error: "invalid_amount" };
  const result = await callRpc("close_cashier_session", {
    p_counted_minor: counted,
    p_explanation: String(formData.get("explanation") ?? "").trim() || null,
    p_clinic_id: id,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

/** FIN-001: manual payment (patient by chart number, optional). */
export async function recordPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const id = await clinicId();
  const amount = amountFrom(formData);
  const parsed = z
    .object({
      accountId: z.uuid(),
      method: z.enum(["cash", "pos", "instapay", "bank_transfer"]),
      reference: z.string().trim().max(200).optional(),
      chartNumber: z.coerce.number().int().positive().optional(),
    })
    .safeParse({
      accountId: formData.get("accountId"),
      method: formData.get("method"),
      reference: formData.get("reference") || undefined,
      chartNumber: formData.get("chartNumber") || undefined,
    });
  if (!id || amount === null || amount <= 0) return { error: "invalid_amount" };
  if (!parsed.success) return { error: "invalid_input" };

  let patientId: string | null = null;
  if (parsed.data.chartNumber) {
    const found = await callRpc<{ clinic_patient_id: string }[]>("finance_find_patient", {
      p_clinic_id: id,
      p_chart_number: parsed.data.chartNumber,
    });
    if (found.error) return { error: found.error };
    patientId = found.data[0]?.clinic_patient_id ?? null;
    if (!patientId) return { error: "patient_not_found" };
  }

  const result = await callRpc<string>("record_payment", {
    p_clinic_id: id,
    p_account_id: parsed.data.accountId,
    p_amount_minor: amount,
    p_method: parsed.data.method,
    p_reference: parsed.data.reference ?? null,
    p_clinic_patient_id: patientId,
    p_appointment_id: null,
    p_corrects_transaction_id: z.uuid().safeParse(formData.get("correctsId")).data ?? null,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true, link: `/${locale}/app/finance/receipts/${result.data}` };
}

/** FIN-006/007/008: expense, transfer or refund (direct or for approval per policy). */
export async function submitRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const id = await clinicId();
  const amount = amountFrom(formData);
  const parsed = z
    .object({
      kind: z.enum(["expense", "transfer", "refund"]),
      fromAccountId: z.uuid(),
      toAccountId: z.uuid().optional(),
      originalId: z.uuid().optional(),
      category: z.string().trim().max(100).optional(),
      description: z.string().trim().max(500).optional(),
    })
    .safeParse({
      kind: formData.get("kind"),
      fromAccountId: formData.get("fromAccountId"),
      toAccountId: formData.get("toAccountId") || undefined,
      originalId: formData.get("originalId") || undefined,
      category: formData.get("category") || undefined,
      description: formData.get("description") || undefined,
    });
  if (!id || amount === null || amount <= 0) return { error: "invalid_amount" };
  if (!parsed.success) return { error: "invalid_input" };
  const d = parsed.data;
  const result = await callRpc("submit_finance_request", {
    p_clinic_id: id,
    p_kind: d.kind,
    p_amount_minor: amount,
    p_from_account_id: d.fromAccountId,
    p_to_account_id: d.toAccountId ?? null,
    p_original_transaction_id: d.originalId ?? null,
    p_category: d.category ?? null,
    p_description: d.description ?? null,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function decideRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({ requestId: z.uuid(), approve: z.enum(["true", "false"]), reason: z.string().trim().max(500).optional() })
    .safeParse({
      requestId: formData.get("requestId"),
      approve: formData.get("approve"),
      reason: formData.get("reason") || undefined,
    });
  if (!parsed.success) return { error: "invalid_input" };
  const result = await callRpc("decide_finance_request", {
    p_request_id: parsed.data.requestId,
    p_approve: parsed.data.approve === "true",
    p_reason: parsed.data.reason ?? null,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function reverseTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({ transactionId: z.uuid(), reason: z.string().trim().min(1).max(500) })
    .safeParse({ transactionId: formData.get("transactionId"), reason: formData.get("reason") });
  if (!parsed.success) return { error: "reason_required" };
  const result = await callRpc("reverse_transaction", {
    p_transaction_id: parsed.data.transactionId,
    p_reason: parsed.data.reason,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function approveSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const sessionId = z.uuid().safeParse(formData.get("sessionId"));
  if (!sessionId.success) return { error: "invalid_input" };
  const result = await callRpc("approve_cashier_session", { p_session_id: sessionId.data });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function createHandover(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const amount = amountFrom(formData);
  const parsed = z.object({ sessionId: z.uuid(), toUserId: z.uuid(), toAccountId: z.uuid() }).safeParse({
    sessionId: formData.get("sessionId"),
    toUserId: formData.get("toUserId"),
    toAccountId: formData.get("toAccountId"),
  });
  if (!parsed.success || amount === null || amount <= 0) return { error: "invalid_input" };
  const result = await callRpc("create_cash_handover", {
    p_session_id: parsed.data.sessionId,
    p_to_user_id: parsed.data.toUserId,
    p_to_account_id: parsed.data.toAccountId,
    p_amount_minor: amount,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function acknowledgeHandover(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const handoverId = z.uuid().safeParse(formData.get("handoverId"));
  if (!handoverId.success) return { error: "invalid_input" };
  const result = await callRpc("acknowledge_cash_handover", { p_handover_id: handoverId.data });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function createAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const id = await clinicId();
  const parsed = z
    .object({ name: z.string().trim().min(2).max(100), type: z.enum(["cash_drawer", "safe", "bank", "pos", "wallet"]) })
    .safeParse({ name: formData.get("name"), type: formData.get("type") });
  if (!id || !parsed.success) return { error: "invalid_input" };
  const result = await callRpc("create_financial_account", {
    p_clinic_id: id,
    p_name: parsed.data.name,
    p_type: parsed.data.type,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function submitOpeningBalance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const accountId = z.uuid().safeParse(formData.get("accountId"));
  const amount = amountFrom(formData);
  if (!accountId.success || amount === null) return { error: "invalid_amount" };
  const result = await callRpc("submit_opening_balance", { p_account_id: accountId.data, p_amount_minor: amount });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function decideOpeningBalance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({ requestId: z.uuid(), approve: z.enum(["true", "false"]) })
    .safeParse({ requestId: formData.get("requestId"), approve: formData.get("approve") });
  if (!parsed.success) return { error: "invalid_input" };
  const result = await callRpc("decide_opening_balance", {
    p_request_id: parsed.data.requestId,
    p_approve: parsed.data.approve === "true",
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

const policy = z.enum(["direct", "all_approval", "threshold"]);

export async function savePolicies(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const id = await clinicId();
  const parsed = z
    .object({
      expense: policy,
      transfer: policy,
      refund: policy,
      discrepancy: z.enum(["warning", "explanation_required", "approval_required"]),
      daily: z.enum(["sessions_only", "daily_close_required", "daily_close_approval"]),
    })
    .safeParse({
      expense: formData.get("expense"),
      transfer: formData.get("transfer"),
      refund: formData.get("refund"),
      discrepancy: formData.get("discrepancy"),
      daily: formData.get("daily"),
    });
  if (!id || !parsed.success) return { error: "invalid_input" };
  const threshold = (name: string) => (formData.get(name) ? amountFrom(formData, name) : null);
  const d = parsed.data;
  const result = await callRpc("set_finance_policies", {
    p_clinic_id: id,
    p_expense_policy: d.expense,
    p_expense_threshold_minor: threshold("expenseThreshold"),
    p_transfer_policy: d.transfer,
    p_transfer_threshold_minor: threshold("transferThreshold"),
    p_refund_policy: d.refund,
    p_refund_threshold_minor: threshold("refundThreshold"),
    p_discrepancy_policy: d.discrepancy,
    p_daily_closing_policy: d.daily,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

/** FIN-010: owner grants finance capabilities to roles. */
export async function setFinancePermission(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const id = await clinicId();
  const parsed = z
    .object({
      role: z.enum(["manager", "receptionist", "cashier"]),
      capability: z.enum(["finance.collect", "finance.approve", "finance.reports", "finance.accounts"]),
      allowed: z.enum(["true", "false"]),
    })
    .safeParse({
      role: formData.get("role"),
      capability: formData.get("capability"),
      allowed: formData.get("allowed"),
    });
  if (!id || !parsed.success) return { error: "invalid_input" };
  const result = await callRpc("set_role_permission", {
    p_clinic_id: id,
    p_role: parsed.data.role,
    p_capability: parsed.data.capability,
    p_allowed: parsed.data.allowed === "true",
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function submitDailyClose(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const id = await clinicId();
  const date = z.iso.date().safeParse(formData.get("date"));
  if (!id || !date.success) return { error: "invalid_input" };
  const result = await callRpc("submit_daily_close", { p_clinic_id: id, p_date: date.data });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function approveDailyClose(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const id = await clinicId();
  const date = z.iso.date().safeParse(formData.get("date"));
  if (!id || !date.success) return { error: "invalid_input" };
  const result = await callRpc("approve_daily_close", { p_clinic_id: id, p_date: date.data });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}
