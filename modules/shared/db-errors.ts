/**
 * Maps errors raised by our SQL functions (see the error contract in
 * supabase/migrations/20261028120000_onboarding_and_staff.sql) to stable codes
 * that the UI translates. Unknown errors become "unexpected" so database
 * internals are never shown to users.
 */
export const DOMAIN_ERROR_CODES = [
  "forbidden",
  "account_name_taken",
  "account_not_active",
  "already_acknowledged",
  "already_booked",
  "already_closed",
  "already_doctor",
  "already_member",
  "already_refunded_or_reversed",
  "appointment_not_found",
  "cannot_approve_own",
  "cannot_change_self",
  "cannot_reverse_reversal",
  "capability_not_grantable",
  "clinic_not_editable",
  "clinic_not_found",
  "clinic_not_operational",
  "clinic_not_pending",
  "close_session_first",
  "consent_evidence_required",
  "consultation_locked",
  "consultation_not_completed",
  "correct_requires_reversal",
  "daily_close_not_used",
  "disclaimer_not_current",
  "email_not_confirmed",
  "explanation_required",
  "file_not_found",
  "full_refund_only",
  "identity_mismatch",
  "invalid_amount",
  "invalid_clinic_name",
  "invalid_decision",
  "invalid_email",
  "invalid_file",
  "invalid_name",
  "invalid_patient",
  "invalid_payload",
  "invalid_request",
  "invalid_role",
  "invalid_slot",
  "invalid_storage_path",
  "invalid_template",
  "invalid_transition",
  "invalid_value",
  "invitation_closed",
  "invitation_email_mismatch",
  "invitation_expired",
  "invitation_invalid",
  "invitation_pending",
  "invitation_revoked",
  "invitation_used",
  "license_not_found",
  "license_not_reviewable",
  "licenses_not_approved",
  "membership_deactivated",
  "method_account_mismatch",
  "no_open_session",
  "not_a_doctor_member",
  "not_session_day",
  "offer_closed",
  "offer_invalid",
  "online_booking_unavailable",
  "overbooking_not_allowed",
  "owner_protected",
  "patient_not_arrived",
  "patient_not_found",
  "payment_not_found",
  "placement_not_allowed",
  "reason_required",
  "reference_required",
  "request_not_open",
  "request_pending",
  "required_fields_missing",
  "session_already_open",
  "session_cancelled",
  "session_full",
  "session_in_past",
  "session_not_found",
  "session_overlap",
  "sessions_not_closed",
  "slot_taken",
  "template_required",
  "too_early",
  "too_many_pending_clinics",
  "too_many_requests",
  "walk_in_requires_queue",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number] | "invalid_input" | "unexpected";

const KNOWN = new Set<string>(DOMAIN_ERROR_CODES);

export function toDomainError(error: { message?: string; code?: string } | null | undefined): DomainErrorCode {
  if (!error) return "unexpected";
  if (error.code === "42501") return "forbidden";
  if (error.message && KNOWN.has(error.message)) return error.message as DomainErrorCode;
  return "unexpected";
}

export type ActionResult<T = undefined> =
  ({ ok: true } & (T extends undefined ? object : { data: T })) | { ok: false; error: DomainErrorCode };
