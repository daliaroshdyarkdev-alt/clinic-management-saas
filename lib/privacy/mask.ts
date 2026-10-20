/**
 * Minimum-necessary display helpers (PAT-005). Use them in UI lists and in
 * anything that may reach logs. They are not a substitute for authorization.
 */

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "•".repeat(digits.length);
  return `${digits.slice(0, 3)}${"•".repeat(digits.length - 5)}${digits.slice(-2)}`;
}

export function maskIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "•".repeat(trimmed.length);
  return `${"•".repeat(trimmed.length - 4)}${trimmed.slice(-4)}`;
}

/** First name plus initials of the remaining names, e.g. "Test P. S.". */
export function maskName(fullName: string): string {
  const [first = "", ...rest] = fullName.trim().split(/\s+/);
  return [first, ...rest.map((part) => `${part.charAt(0)}.`)].join(" ");
}
