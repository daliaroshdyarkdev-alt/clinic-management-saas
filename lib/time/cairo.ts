/**
 * Clinic time helpers. Timestamps are stored in UTC; clinics operate in
 * Africa/Cairo local time. Egypt observes daylight saving time (since 2023),
 * so never add a fixed +2/+3 offset by hand — always go through Intl with the
 * IANA zone.
 */
export const CLINIC_TIME_ZONE = "Africa/Cairo";

export function formatClinicDateTime(utc: Date, locale: "ar" | "en"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    timeZone: CLINIC_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(utc);
}

/** Offset of Africa/Cairo from UTC, in minutes, at the given instant. */
export function cairoOffsetMinutes(utc: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utc);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utc.getTime() / 1000) * 1000) / 60_000);
}

/** Calendar date (YYYY-MM-DD) in Cairo for the given instant. */
export function cairoDateKey(utc: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(utc);
}
