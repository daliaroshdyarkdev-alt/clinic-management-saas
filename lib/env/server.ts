import "server-only";

import { serverEnvSchema, type ServerEnv } from "./server-schema";

let cached: ServerEnv | undefined;

/**
 * Server-only configuration. Future secrets (Supabase secret key, Meta tokens,
 * payment keys) are added here and must never use the NEXT_PUBLIC_ prefix.
 */
export function serverEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse({
    APP_ENV: process.env.APP_ENV || undefined,
    UI_PREVIEW_ENABLED: process.env.UI_PREVIEW_ENABLED,
  });
  return cached;
}

export function isUiPreviewEnabled(): boolean {
  return serverEnv().UI_PREVIEW_ENABLED;
}
