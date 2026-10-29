import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { z } from "zod";
import { FieldValue } from "@/components/clinical/field-value";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { enterRouteLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { readExternalRecords } from "@/modules/clinical/queries";

/** MED-008: view-only; there is deliberately no download or export. */
export default async function ExternalRecordsPage({
  params,
}: PageProps<"/[locale]/app/consultations/[consultationId]/external/[grantId]">) {
  const { locale, consultationId, grantId } = await params;
  enterRouteLocale(locale);
  if (!z.uuid().safeParse(consultationId).success || !z.uuid().safeParse(grantId).success) notFound();
  const t = await getTranslations("consultation");
  const format = await getFormatter();
  const records = await readExternalRecords(grantId);

  return (
    <div className="grid max-w-4xl gap-4">
      <Link
        href={`/app/consultations/${consultationId}`}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        {t("backToVisit")}
      </Link>
      {!records ? (
        <p className="text-muted-foreground">{t("externalUnavailable")}</p>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{t("externalFrom", { clinic: records.source_clinic })}</h1>
          <p role="note" className="rounded-md bg-warning p-2 text-sm text-warning-foreground">
            {t("viewOnlyNotice")}
          </p>
          {records.consultations.map((c, i) => (
            <Card key={i}>
              <CardHeader>
                <CardTitle>
                  <h2 className="text-base">
                    {format.dateTime(new Date(c.completed_at), { dateStyle: "medium" })} · {c.doctor}
                  </h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-2 text-sm">
                  {c.fields.map((f) => (
                    <div key={f.key}>
                      <dt className="text-muted-foreground">{f.label}</dt>
                      <dd>
                        <FieldValue field={f} value={c.values[f.key]} yes={t("yes")} no={t("no")} />
                      </dd>
                    </div>
                  ))}
                </dl>
                {c.corrections.map((x, j) => (
                  <p key={j} className="mt-2 whitespace-pre-wrap rounded-md bg-accent p-2 text-sm">
                    {x.body}
                  </p>
                ))}
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
