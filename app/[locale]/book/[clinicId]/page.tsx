import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { z } from "zod";
import { PublicShell } from "@/components/public/public-shell";
import { enterRouteLocale } from "@/i18n/locale";
import { logger } from "@/lib/telemetry/logger";
import { getBookingOptions, type BookingOptions } from "@/modules/public-booking/service";
import { RequestForm, type SlotGroup } from "./request-form";

/** APT-001: public booking request page (no account; never a confirmed booking). */
export default async function PublicBookingPage({ params }: PageProps<"/[locale]/book/[clinicId]">) {
  const { locale, clinicId } = await params;
  enterRouteLocale(locale);
  if (!z.uuid().safeParse(clinicId).success) notFound();
  const t = await getTranslations("publicBooking");
  const format = await getFormatter();

  let options: BookingOptions | null = null;
  try {
    options = await getBookingOptions(clinicId);
  } catch {
    logger.error({ event: "public_booking.options_failed" });
  }

  if (!options) {
    return (
      <PublicShell>
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("unavailable")}</p>
      </PublicShell>
    );
  }

  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const groups: SlotGroup[] = options.doctors
    .map((d) => ({
      doctor: d.specialty ? `${d.name} — ${d.specialty}` : d.name,
      options: d.sessions.flatMap((s) =>
        s.method === "queue"
          ? (s.remaining ?? 0) > 0
            ? [{ value: s.id, label: `${when(s.starts_at)} (${t("queue")})` }]
            : []
          : s.free_slots.map((slot) => ({ value: `${s.id}|${slot}`, label: when(slot) })),
      ),
    }))
    .filter((g) => g.options.length > 0);

  return (
    <PublicShell>
      <h1 className="text-xl font-semibold">{options.clinic_name}</h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      {groups.length === 0 ? (
        <p className="text-muted-foreground">{t("noAvailability")}</p>
      ) : (
        <RequestForm clinicId={clinicId} groups={groups} />
      )}
    </PublicShell>
  );
}
