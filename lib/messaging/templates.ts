import type { TemplateKey } from "./types.ts";

/**
 * Named body parameters of each approved template (the catalogue in
 * supabase/migrations/20261101100000_messaging.sql). Arabic and English
 * versions use the same names, so word order may differ per language.
 */
export const TEMPLATE_PARAMETERS: Record<TemplateKey, readonly string[]> = {
  request_received: ["clinic", "doctor"],
  request_approved: ["clinic", "doctor", "when"],
  request_rejected: ["clinic"],
  alternative_proposal: ["clinic", "doctor", "when", "link"],
  reminder: ["clinic", "doctor", "when"],
  cancellation: ["clinic", "when"],
  session_cancellation: ["doctor", "when"],
  no_show: ["clinic", "when"],
};

export function isTemplateKey(value: string): value is TemplateKey {
  return Object.hasOwn(TEMPLATE_PARAMETERS, value);
}

/** Clinic-local display time; storage stays UTC. */
export function formatWhen(iso: string, language: "ar" | "en"): string {
  return new Intl.DateTimeFormat(language === "ar" ? "ar-EG" : "en-GB", {
    timeZone: "Africa/Cairo",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export type IntentForRender = {
  template_key: string;
  language: "ar" | "en";
  variables: Record<string, unknown>;
  offer_id: string | null;
};

/**
 * Builds provider parameters from intent variables. Throws on a missing
 * variable so a malformed intent fails instead of sending a broken message.
 */
export function renderTemplate(
  intent: IntentForRender,
  siteUrl: string,
): { parameters: Record<string, string>; buttonPayloads: string[] } {
  if (!isTemplateKey(intent.template_key)) throw new Error("unknown_template");
  const v = intent.variables;
  const text = (key: string) => (typeof v[key] === "string" && v[key] ? (v[key] as string) : null);
  const values: Record<string, string | null> = {
    clinic: text("clinic"),
    doctor: text("doctor"),
    when: text("starts_at") ? formatWhen(text("starts_at")!, intent.language) : null,
    link: text("offer_token")
      ? `${siteUrl.replace(/\/$/, "")}/${intent.language}/offer/${encodeURIComponent(text("offer_token")!)}`
      : null,
  };
  const parameters: Record<string, string> = {};
  for (const name of TEMPLATE_PARAMETERS[intent.template_key]) {
    const value = values[name];
    if (!value) throw new Error(`missing_variable_${name}`);
    parameters[name] = value.slice(0, 1024);
  }
  const buttonPayloads =
    intent.template_key === "alternative_proposal" && intent.offer_id
      ? [`offer_accept:${intent.offer_id}`, `offer_decline:${intent.offer_id}`]
      : [];
  return { parameters, buttonPayloads };
}
