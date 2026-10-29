import { cairoDateKey } from "./cairo";

/** Today's calendar date (YYYY-MM-DD) in Cairo. */
export function cairoToday(now: Date = new Date()): string {
  return cairoDateKey(now);
}

/** Adds days to a YYYY-MM-DD date key (calendar arithmetic, no time zone involved). */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function isDateKey(value: unknown): value is string {
  return (
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}
