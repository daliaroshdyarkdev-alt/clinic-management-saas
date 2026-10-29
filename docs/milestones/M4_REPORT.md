# Milestone 4 — Evidence Report

**Scope:** clinic finance (FIN-001..015).

**Built:** migrations `20261031090000_finance_capabilities.sql`, `20261031100000_finance.sql`, `20261031110000_finance_helpers.sql` — double-entry ledger in integer piasters with commit-time balance check; append-only transactions/journal for every role; accounts with owner-approved opening balances; cashier sessions (expected cash, immutable count/discrepancy, discrepancy policy); acknowledged cash handovers; expense/transfer/refund requests posted directly or after approval per clinic policy (thresholds supported); full refunds; linked reversals and corrections; daily closing; reports (by day, method, doctor, category, balances, sessions, staff activity, monthly) and audited CSV export; owner-granted finance capabilities. UI: cashier desk, approvals, ledger & reports, setup (accounts, policies, permissions), printable internal receipt, CSV export route (formula-injection safe).

**Results:** typecheck, lint, format, build pass · unit 51 · DB **176** (19 new) · e2e 32.

**Evidence:** reversal + corrected entry leaves the original untouched and reconciles revenue and balances (acceptance 6); handover posts only on the recipient's acknowledgement and exactly once under 6 concurrent acknowledgements; counted/discrepancy values immutable after closing (acceptance 7); unbalanced journals rejected at commit; transfers, POS settlement and opening balances never count as revenue; platform admins, other clinics and doctors see no finance data. Mutation: removing the handover row lock fails the concurrency test. Bug found by tests: the commit-time balance check ran under the caller's RLS and saw no lines — now SECURITY DEFINER.

**Gaps:** partial refunds, tax treatment (FIN-016, OD-L04); discrepancy adjusting entries (OD-B17); receipts via WhatsApp (M5); signed-in browser tests pending.
