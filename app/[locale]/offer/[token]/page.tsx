import { getFormatter, getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/public/public-shell";
import { enterRouteLocale } from "@/i18n/locale";
import { logger } from "@/lib/telemetry/logger";
import { getOffer, type PublicOffer } from "@/modules/public-booking/service";
import { AnswerForm } from "./answer-form";

const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

/** APT-003: the patient answers a proposed alternative through a private link. */
export default async function OfferPage({ params }: PageProps<"/[locale]/offer/[token]">) {
  const { locale, token } = await params;
  enterRouteLocale(locale);
  const t = await getTranslations("offer");
  const format = await getFormatter();

  let offer: PublicOffer | null = null;
  if (TOKEN.test(token)) {
    try {
      offer = await getOffer(token);
    } catch {
      logger.error({ event: "offer.load_failed" });
    }
  }

  return (
    <PublicShell>
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      {!offer ? (
        <p className="text-muted-foreground">{t("invalid")}</p>
      ) : (
        <>
          <p>
            {t("summary", {
              clinic: offer.clinic_name,
              doctor: offer.doctor_name,
              when: format.dateTime(new Date(offer.starts_at ?? offer.session_starts_at), {
                dateStyle: "full",
                timeStyle: "short",
              }),
            })}
          </p>
          {offer.method === "queue" ? <p className="text-sm text-muted-foreground">{t("queueNote")}</p> : null}
          {offer.status === "offered" ? (
            <>
              <p className="text-sm text-muted-foreground">{t("notHeld")}</p>
              <AnswerForm token={token} />
            </>
          ) : (
            <p className="text-muted-foreground">{t(`closed.${offer.status}`)}</p>
          )}
        </>
      )}
    </PublicShell>
  );
}
