import { renderTemplate } from "./templates.ts";
import type { WhatsAppProvider } from "./types.ts";

/** Minimal service-role RPC surface the worker needs (worker_* functions only). */
export type WorkerRpc = <T>(fn: string, args?: Record<string, unknown>) => Promise<T>;

export type ClaimedMessage = {
  intent_id: string;
  clinic_id: string;
  phone_number_id: string;
  credential_ref: string;
  recipient_phone_e164: string;
  template_key: string;
  provider_template: string;
  language: "ar" | "en";
  variables: Record<string, unknown>;
  offer_id: string | null;
  attempts: number;
};

export type WorkerDeps = {
  rpc: WorkerRpc;
  provider: WhatsAppProvider;
  /** Resolves a connection's credential reference to its access token. */
  resolveToken: (credentialRef: string) => string | undefined;
  siteUrl: string;
  log: (fields: Record<string, unknown>) => void;
};

/**
 * One dispatch pass: claim due messages (all send-time checks and the budget
 * reservation happen inside the claim), send them and record results.
 * Delivery is at-least-once; expired leases return to the queue.
 */
export async function dispatchOnce(deps: WorkerDeps, batch = 20): Promise<number> {
  const claimed = await deps.rpc<ClaimedMessage[]>("worker_claim_messages", { p_limit: batch });
  for (const m of claimed) {
    let result: { ok: true; providerMessageId: string } | { ok: false; errorCode: string; retryable: boolean };
    const token = deps.resolveToken(m.credential_ref);
    if (!token) {
      result = { ok: false, errorCode: "credential_missing", retryable: false };
    } else {
      try {
        const rendered = renderTemplate(m, deps.siteUrl);
        result = await deps.provider.sendTemplate({
          phoneNumberId: m.phone_number_id,
          accessToken: token,
          to: m.recipient_phone_e164,
          templateName: m.provider_template,
          language: m.language,
          ...rendered,
        });
      } catch (error) {
        result = { ok: false, errorCode: (error as Error).message.slice(0, 100), retryable: false };
      }
    }
    await deps.rpc("worker_record_send_result", {
      p_intent_id: m.intent_id,
      p_ok: result.ok,
      p_provider_message_id: result.ok ? result.providerMessageId : null,
      p_error_code: result.ok ? null : result.errorCode,
      p_retryable: result.ok ? false : result.retryable,
    });
    deps.log({
      event: "whatsapp.send",
      jobId: m.intent_id,
      clinicId: m.clinic_id,
      attempt: m.attempts,
      status: result.ok ? "sent" : "failed",
      errorCode: result.ok ? null : result.errorCode,
    });
  }
  return claimed.length;
}

/** WAP-011: checks every connection and records status transitions. */
export async function checkConnections(deps: WorkerDeps): Promise<void> {
  const connections =
    await deps.rpc<{ clinic_id: string; phone_number_id: string; credential_ref: string }[]>("worker_connections");
  for (const c of connections) {
    const token = deps.resolveToken(c.credential_ref);
    const health = token
      ? await deps.provider.checkHealth(c.phone_number_id, token)
      : { ok: false, errorCode: "credential_missing" };
    await deps.rpc("worker_set_connection_status", {
      p_clinic_id: c.clinic_id,
      p_status: health.ok ? "connected" : "error",
      p_error: health.ok ? null : (health.errorCode ?? "unknown"),
    });
  }
}

/** Token lookup: WHATSAPP_TOKEN__<CREDENTIAL_REF> in the worker environment. */
export function envTokenResolver(env: Record<string, string | undefined>) {
  return (credentialRef: string) =>
    /^[A-Z0-9_]{3,64}$/.test(credentialRef) ? env[`WHATSAPP_TOKEN__${credentialRef}`] || undefined : undefined;
}
