import type { Locale } from "@/lib/i18n/config";

/** Clinic-local time zone (SRS §6). Timestamps are stored in UTC. */
export const CLINIC_TIME_ZONE = "Africa/Cairo";

const intlLocale: Record<Locale, string> = {
  ar: "ar-EG-u-nu-arab",
  en: "en-EG",
};

function toDate(value: Date | string): Date {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid timestamp: ${String(value)}`);
  return date;
}

/** Formats a UTC instant as Cairo wall-clock time, e.g. "10:30 AM" / "١٠:٣٠ ص". */
export function formatClinicTime(value: Date | string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    timeZone: CLINIC_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(toDate(value));
}

/** Formats a UTC instant as a Cairo calendar date. */
export function formatClinicDate(value: Date | string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    timeZone: CLINIC_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(toDate(value));
}

/** The Cairo calendar date (YYYY-MM-DD) that a UTC instant falls on. */
export function clinicDateKey(value: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(toDate(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale[locale]).format(value);
}
