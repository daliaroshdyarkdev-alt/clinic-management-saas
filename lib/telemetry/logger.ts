/**
 * Structured logger with an allow-list of fields (SRS §2.1 invariant 7).
 * Anything not explicitly allowed is replaced with "[redacted]", so patient
 * names, phone numbers, medical content and amounts can never reach logs or
 * telemetry by accident. Add a key here only if it can never carry personal,
 * clinical or financial data.
 */
const ALLOWED_KEYS = new Set([
  "event",
  "requestId",
  "route",
  "method",
  "status",
  "durationMs",
  "errorCode",
  "errorName",
  "clinicId",
  "userId",
  "jobId",
  "attempt",
]);

export type LogFields = Record<string, unknown>;

export function redact(fields: LogFields): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_KEYS.has(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string") {
      out[key] = value.slice(0, 200);
    } else {
      out[key] = "[redacted]";
    }
  }
  return out;
}

type Level = "info" | "warn" | "error";

function emit(level: Level, fields: LogFields) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), ...redact(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const logger = {
  info: (fields: LogFields) => emit("info", fields),
  warn: (fields: LogFields) => emit("warn", fields),
  error: (fields: LogFields) => emit("error", fields),
};
