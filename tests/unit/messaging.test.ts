import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MetaCloudProvider } from "@/lib/messaging/meta";
import { MockWhatsAppProvider } from "@/lib/messaging/mock";
import { renderTemplate, TEMPLATE_PARAMETERS } from "@/lib/messaging/templates";
import { parseWebhook, verifySignature } from "@/lib/messaging/webhook";
import { dispatchOnce, envTokenResolver, type ClaimedMessage } from "@/lib/messaging/worker-core";

const SECRET = "synthetic-app-secret";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

describe("webhook signature (WAP-006)", () => {
  const body = '{"entry":[]}';
  it("accepts the provider's HMAC and rejects anything else", () => {
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
    expect(verifySignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(verifySignature(body, sign(body).replace("sha256=", "sha1="), SECRET)).toBe(false);
    expect(verifySignature(body, "sha256=abcd", SECRET)).toBe(false);
    expect(verifySignature(body, null, SECRET)).toBe(false);
    expect(verifySignature(body, sign(body), "")).toBe(false);
  });
});

describe("webhook parsing", () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "123456789" },
              statuses: [
                { id: "wamid.A", status: "delivered", pricing: { billable: true } },
                { id: "wamid.A", status: "failed", errors: [{ code: 131026 }] },
                { id: "wamid.B", status: "deleted" },
              ],
              messages: [
                {
                  id: "wamid.R1",
                  type: "button",
                  button: { payload: "offer_accept:7c9e6679-7425-40de-944b-e07fc1f90ae7" },
                },
                { id: "wamid.R2", type: "text", text: { body: "Synthetic private text" } },
              ],
            },
          },
        ],
      },
    ],
  };

  it("normalises statuses and replies with stable event ids and no message text", () => {
    const events = parseWebhook(payload);
    expect(events.map((e) => e.eventId)).toEqual([
      "status:wamid.A:delivered",
      "status:wamid.A:failed",
      "message:wamid.R1",
      "message:wamid.R2",
    ]);
    expect(events[0]).toMatchObject({ billable: true, status: "delivered" });
    expect(events[1].errorCode).toBe("meta_131026");
    expect(events[2].replyId).toBe("offer_accept:7c9e6679-7425-40de-944b-e07fc1f90ae7");
    expect(events[3].replyId).toBe("free_text");
    expect(JSON.stringify(events)).not.toContain("Synthetic private text");
  });

  it("ignores malformed payloads", () => {
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: "x", status: "read" }] } }] }] })).toEqual(
      [],
    );
  });
});

describe("template rendering", () => {
  const base = { language: "en" as const, offer_id: null };

  it("maps variables to the template's named parameters in Cairo time", () => {
    const r = renderTemplate(
      { ...base, template_key: "reminder", variables: { clinic: "C", doctor: "D", starts_at: "2026-11-02T08:00:00Z" } },
      "https://example.test",
    );
    expect(Object.keys(r.parameters)).toEqual([...TEMPLATE_PARAMETERS.reminder]);
    expect(r.parameters.when).toContain("10:00");
  });

  it("builds the offer link and reply buttons for proposals", () => {
    const r = renderTemplate(
      {
        template_key: "alternative_proposal",
        language: "ar",
        offer_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        variables: { clinic: "C", doctor: "D", starts_at: "2026-11-02T08:00:00Z", offer_token: "tok_en-1" },
      },
      "https://example.test/",
    );
    expect(r.parameters.link).toBe("https://example.test/ar/offer/tok_en-1");
    expect(r.buttonPayloads).toEqual([
      "offer_accept:7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "offer_decline:7c9e6679-7425-40de-944b-e07fc1f90ae7",
    ]);
  });

  it("refuses to send with a missing variable or unknown template", () => {
    expect(() => renderTemplate({ ...base, template_key: "reminder", variables: { clinic: "C" } }, "x")).toThrow(
      "missing_variable_doctor",
    );
    expect(() => renderTemplate({ ...base, template_key: "marketing", variables: {} }, "x")).toThrow();
  });
});

describe("Meta Cloud provider", () => {
  const message = {
    phoneNumberId: "123456789",
    accessToken: "synthetic-token",
    to: "+201000000000",
    templateName: "clinic_reminder_en",
    language: "en" as const,
    parameters: { clinic: "C" },
    buttonPayloads: ["offer_accept:x"],
  };

  it("posts a template message with named parameters", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const provider = new MetaCloudProvider({
      fetchImpl: async (url, init) => {
        captured = { url, init };
        return new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 });
      },
    });
    expect(await provider.sendTemplate(message)).toEqual({ ok: true, providerMessageId: "wamid.X" });
    expect(captured!.url).toBe("https://graph.facebook.com/v21.0/123456789/messages");
    const body = JSON.parse(String(captured!.init!.body));
    expect(body.to).toBe("201000000000");
    expect(body.template.components[0].parameters[0]).toEqual({ type: "text", parameter_name: "clinic", text: "C" });
    expect(body.template.components[1]).toMatchObject({ sub_type: "quick_reply", index: "0" });
  });

  it("classifies errors as retryable or permanent", async () => {
    const respond = (status: number, code?: number) =>
      new MetaCloudProvider({
        fetchImpl: async () => new Response(JSON.stringify(code ? { error: { code } } : {}), { status }),
      }).sendTemplate(message);
    expect(await respond(400, 132001)).toEqual({ ok: false, errorCode: "meta_132001", retryable: false });
    expect(await respond(400, 131056)).toMatchObject({ retryable: true });
    expect(await respond(503)).toEqual({ ok: false, errorCode: "http_503", retryable: true });
    const offline = new MetaCloudProvider({ fetchImpl: async () => Promise.reject(new Error("down")) });
    expect(await offline.sendTemplate(message)).toMatchObject({ errorCode: "network_error", retryable: true });
  });
});

describe("worker dispatch", () => {
  const claimed: ClaimedMessage = {
    intent_id: "i1",
    clinic_id: "c1",
    phone_number_id: "123456789",
    credential_ref: "WA_ONE",
    recipient_phone_e164: "+201000000000",
    template_key: "request_rejected",
    provider_template: "clinic_request_rejected_ar",
    language: "ar",
    variables: { clinic: "C" },
    offer_id: null,
    attempts: 1,
  };

  function harness(token: string | undefined) {
    const calls: { fn: string; args?: Record<string, unknown> }[] = [];
    const provider = new MockWhatsAppProvider();
    const deps = {
      rpc: async <T>(fn: string, args?: Record<string, unknown>) => {
        calls.push({ fn, args });
        return (fn === "worker_claim_messages" ? [claimed] : null) as T;
      },
      provider,
      resolveToken: () => token,
      siteUrl: "https://example.test",
      log: () => {},
    };
    return { calls, provider, deps };
  }

  it("sends and records the provider id", async () => {
    const h = harness("synthetic-token");
    expect(await dispatchOnce(h.deps)).toBe(1);
    expect(h.provider.sent).toHaveLength(1);
    expect(h.calls[1]).toEqual({
      fn: "worker_record_send_result",
      args: {
        p_intent_id: "i1",
        p_ok: true,
        p_provider_message_id: "wamid.mock.1",
        p_error_code: null,
        p_retryable: false,
      },
    });
  });

  it("fails permanently without a credential and never calls the provider", async () => {
    const h = harness(undefined);
    await dispatchOnce(h.deps);
    expect(h.provider.sent).toHaveLength(0);
    expect(h.calls[1].args).toMatchObject({ p_ok: false, p_error_code: "credential_missing", p_retryable: false });
  });

  it("resolves tokens only for well-formed references", () => {
    const resolve = envTokenResolver({ WHATSAPP_TOKEN__WA_ONE: "t" });
    expect(resolve("WA_ONE")).toBe("t");
    expect(resolve("wa_one")).toBeUndefined();
    expect(resolve("../X")).toBeUndefined();
  });
});
