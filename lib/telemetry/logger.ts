import { redact } from "./redact";

type Level = "debug" | "info" | "warn" | "error";

/**
 * Structured, redacting logger. Pass identifiers (request id, clinic id,
 * resource id) as context. Never pass record bodies.
 */
export function log(level: Level, event: string, context: Record<string, unknown> = {}): void {
  const entry = JSON.stringify({ level, event, ...(redact(context) as Record<string, unknown>) });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}
