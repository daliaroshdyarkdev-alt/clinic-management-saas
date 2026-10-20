# Logical Data Model Blueprint (not executable migrations)
**PROPOSED ENGINEERING:** Claude Code must produce migrations progressively and validate with tests. Never automatically create these tables and assume the schema has been approved. This is a relational planning map; exact column names and relational splitting may evolve.

## Security and shared identity
| Table / aggregate | Key fields or relationships | Notes |
|---|---|---|
| auth.users (Supabase managed) | auth user identity | No plain passwords in app tables |
| user_profiles | user_id, name, normalized phone, locale | Multi-clinic identity |
| clinics | id, account_state, timezone, name, subscription_id | Isolated tenant |
| clinic_licenses | clinic_id, license_type, file_path, review_status | Private objects, verification revision history |
| clinic_memberships | clinic_id, user_id, role_id, status | Independent invitation and deactivation per clinic |
| clinic_invitations | clinic_id, invitee, token_hash, expiry, accepted_at | Single-use invite |
| roles / permission_grants | clinic_id, role_type, capability, boolean | Owner-only configuration |
| patient_identities | id, demographic identity and masked ID | Shared identity, safeguarded mapping |
| clinic_patients | clinic_id, patient_id, local chart no., operational metadata | Never exposes other clinics' chart |
| duplicate_candidates | clinic_id, patient_ids, score/reason, status | Flag only; no automerge |

## Appointment and queues
| Table / aggregate | Key fields or relationships | Notes |
|---|---|---|
| doctors | user_id, professional metadata | Doctor can belong to clinics |
| clinic_doctors | clinic_id, doctor_id, active/pending, subscription capacity | Distinct from employee membership if needed |
| doctor_scheduling_policies | clinic_id, doctor_id, method, capacity, duration, rules JSON (validated) | Strong schema version for settings |
| doctor_weekly_schedules | doctor_id, clinic_id, weekday, start/end | Recurring weekly slots |
| doctor_schedule_exceptions | doctor_id, clinic_id, date, override | Date-specific |
| doctor_sessions | clinic_id, doctor_id, day, start/end, status, max capacity | Queue/session boundary |
| appointment_requests | clinic_id, patient_id, doctor_id, requested time/status | Online requests require approval |
| appointments | clinic_id, patient_id, doctor_id, session_id, scheduled_at, status | Booking reference and immutable events |
| alternative_offers | request_id, proposed_at, proposed_slot, state | NO capacity hold, recheck on accept |
| queue_reservations | session_id, reservation_number | Allocated at confirmation |
| queue_checkins | session_id, waiting_number, checkin_time, queue_state | Allocated at check-in; atomic |
| appointment_events | appointment_id, actor, from/to, reason, timestamp | Audited state changes |

## Medical and patient consent
| Table / aggregate | Key fields or relationships | Notes |
|---|---|---|
| medical_template_versions | clinic_id, doctor_id, schema, version, archived_fields | Mutable templates, immutable history |
| consultations | clinic_id, assigned_doctor_id, patient_id, appointment_id, status | Open draft vs completed |
| medical_entries | consultation_id, structured_payload, version, locked_at | Very limited read policies |
| medical_corrections | consultation_id, original_entry_id, actor, text, created_at | Append-only |
| cross_clinic_access_grants | patient_id, source_clinic_id, destination_clinic_id, visit_id, doctor_id, method, granted_at, revoked_at, expires_on_completion | Per visit + clinic; not broad patient history grant |
| consent_evidence | consent_id, proof_ref, verified_by, details | Separate WhatsApp communications consent |
| clinical_access_events | request_id, actor, visit_id, action, scope, timestamp | No medical contents |

## Financial controls
| Table / aggregate | Key fields or relationships | Notes |
|---|---|---|
| financial_accounts | clinic_id, account_type, status | Opening balances approved |
| opening_balance_requests | account_id, amount_minor, submitted_by, approved_by, status | Non-revenue posting |
| financial_transactions | clinic_id, type, amount_minor, currency, method, actor, status, created_at, source_id | Posted records immutable |
| journal_entries | transaction_id, financial_account_id, debit_minor, credit_minor | Balanced postings (engineering design) |
| financial_reversals | original_txn_id, reversal_txn_id, replacement_txn_id, reason | Immutability |
| payments | clinic_id, patient_id, appointment_id, transaction_id, evidence | Manual records |
| refund_requests / refunds | original_payment_id, approval_id, refund_txn_id, reason | Linked payout |
| expenses / expense_approvals | clinic_id, amount, policy, approved_by | Workflow state separated from posting |
| transfers / transfer_approvals | from/to accounts, transaction links | No revenue recognition |
| cashier_sessions | clinic_id, user_id, opening, closing, count, discrepancy | Individual shift accountability |
| cashier_handovers | session_id, from_user, to_user, acknowledged_at | Formal receipt |
| daily_financial_closings | clinic_id, date, policy, submitted_by, approved_by | Configurable per clinic |
| receipts | transaction_id, file_ref, delivery_metadata | Retain record independent of delivery |

## WhatsApp / platform billing
| Table / aggregate | Key fields or relationships | Notes |
|---|---|---|
| whatsapp_connections | clinic_id, phone_number_id, ownership_mode, state, encrypted token ref | Meta/provider eligibility |
| whatsapp_template_catalog | template_key, lang, category, approved_version | Predefined library |
| clinic_message_templates | clinic_id, template_id, approved_version, variables | Customize subject to approval |
| messaging_consents | clinic_id, patient_id, scope, source, consented_at, revoked_at | Not medical consent |
| message_intents / messages | clinic_id, patient_id, appointment_id, template, status, idempotency_key | Persist before sending |
| message_attempts / message_webhooks | message_id, provider_id, status, reason, timestamp | Replay-safe, evidence |
| messaging_usage_ledger | clinic_id, message_id, billable_amount, allowance/overage | Atomic budget control |
| platform_plans / plan_versions | doctor_limit, features, allowance, rates, valid_from | Keep snapshots |
| clinic_subscriptions | clinic_id, plan_version_id, period, expiry/grace, trial | Paid-period snapshot |
| plan_change_requests | clinic_id, requested_plan_id, effective_renewal | No early activation |
| subscription_payments | clinic_id, source, reference, verified_at, status | Separate from clinic finances |
| subscription_renewal_authorizations | clinic_id, provider agreement ref, active | Opt-in only |
| subscription_receipts | payment_id, file_ref | After verified payment |
| audit_events | actor, clinic_id nullable, category, resource_id, action, metadata_redacted, timestamp | Append-only, all domains |
| background_jobs / outbox_events | event_type, idempotency_key, status, available_at | Durable and audited |

## Design constraints
- Make tenant foreign keys composite when helpful (`clinic_id`, `id`) so an appointment cannot reference another clinic's patient without explicit rules.
- Public booking intake must use carefully constrained authenticated server endpoints with throttling, anti-bot challenges and minimum data return; never expose unrestricted anon SELECT.
- Sensitive details should not be duplicated into message/webhook payload tables; store references and minimal safe variables.
- All technical storage/retention strategies require local legal review.
- Avoid PostgreSQL SECURITY DEFINER functions for casual reads: where necessary, explicitly check calling user and active authorizations and test bypass attempts.
