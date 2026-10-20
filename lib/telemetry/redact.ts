/**
 * Removes clinical, financial and personal fields from values before they
 * reach logs, error trackers or analytics (invariant 7, STA-007, SRS §5).
 * Allow-listing is preferred at call sites. This is the safety net.
 */

const SENSITIVE_KEY_PATTERN =
  /(password|secret|token|authorization|cookie|api[-_]?key|service[-_]?role|phone|mobile|email|national|identity|id_number|address|dob|birth|name|note|diagnos|medical|clinical|payload|prescription|amount|balance|price|iban|card)/i;

export const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(inner, depth + 1),
      ]),
    );
  }
  if (typeof value === "string") return redactString(value);
  return value;
}

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const LONG_DIGITS_PATTERN = /\+?\d[\d\s-]{7,}\d/g; // phone numbers, national IDs
const BEARER_PATTERN = /bearer\s+[a-z0-9._-]+/gi;

function redactString(value: string): string {
  return value
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(LONG_DIGITS_PATTERN, REDACTED);
}
