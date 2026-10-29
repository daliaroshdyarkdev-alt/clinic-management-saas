// Background worker for WhatsApp messaging (reminders, dispatch, health).
// Run with: node worker/index.ts  (Node >= 22.18 strips TypeScript types).
//
// Required environment:
//   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SECRET_KEY, SITE_URL
//   WHATSAPP_PROVIDER = "meta" | "mock" (default "mock")
//   WHATSAPP_TOKEN__<CREDENTIAL_REF> for each connection's access token
// Secrets come from the deployment's secret store; nothing is logged but
// allow-listed fields.
import { createClient } from "@supabase/supabase-js";
import { MetaCloudProvider } from "../lib/messaging/meta.ts";
import { MockWhatsAppProvider } from "../lib/messaging/mock.ts";
import { logger } from "../lib/telemetry/logger.ts";
import { checkConnections, dispatchOnce, envTokenResolver, type WorkerDeps } from "../lib/messaging/worker-core.ts";

const env = process.env;
const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const secret = env.SUPABASE_SECRET_KEY;
const siteUrl = env.SITE_URL;
if (!url || !secret || !siteUrl) {
  console.error(JSON.stringify({ level: "error", event: "worker.config_missing" }));
  process.exit(1);
}
if (env.WHATSAPP_PROVIDER === "mock" && env.NODE_ENV === "production") {
  console.error(JSON.stringify({ level: "error", event: "worker.mock_in_production" }));
  process.exit(1);
}

const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

const deps: WorkerDeps = {
  rpc: async <T>(fn: string, args?: Record<string, unknown>) => {
    if (!fn.startsWith("worker_")) throw new Error("worker may call worker_* functions only");
    const { data, error } = await supabase.rpc(fn, args ?? {});
    if (error) throw new Error(`rpc_failed:${fn}:${error.code ?? "unknown"}`);
    return data as T;
  },
  provider:
    env.WHATSAPP_PROVIDER === "meta"
      ? new MetaCloudProvider({ graphVersion: env.WHATSAPP_GRAPH_VERSION })
      : new MockWhatsAppProvider(),
  resolveToken: envTokenResolver(env),
  siteUrl,
  log: logger.info,
};

let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastReminders = 0;
let lastHealth = 0;

while (!stopping) {
  try {
    const now = Date.now();
    if (now - lastHealth > 5 * 60_000) {
      await checkConnections(deps);
      lastHealth = now;
    }
    if (now - lastReminders > 60_000) {
      await deps.rpc("worker_schedule_reminders");
      lastReminders = now;
    }
    const sent = await dispatchOnce(deps);
    if (sent === 0) await sleep(5_000);
  } catch (error) {
    logger.error({
      event: "worker.loop_failed",
      errorName: (error as Error).name,
      errorCode: (error as Error).message,
    });
    await sleep(10_000);
  }
}
deps.log({ event: "worker.stopped" });
