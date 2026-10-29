import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { enterRouteLocale } from "@/i18n/locale";
import { formatEgp } from "@/lib/money";
import { callRpc } from "@/modules/shared/rpc";

const receiptSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["payment", "refund"]),
  amount_minor: z.coerce.number(),
  method: z.enum(["cash", "pos", "instapay", "bank_transfer"]).nullable(),
  reference: z.string().nullable(),
  posted_at: z.string(),
  clinic_name: z.string(),
  patient_name: z.string().nullable(),
  chart_number: z.number().nullable(),
  reversed: z.boolean(),
});

/** FIN-011: internal receipt (explicitly not a tax document, OD-L04). */
export default async function ReceiptPage({ params }: PageProps<"/[locale]/app/finance/receipts/[transactionId]">) {
  const { locale: raw, transactionId } = await params;
  enterRouteLocale(raw);
  if (!z.uuid().safeParse(transactionId).success) notFound();
  const t = await getTranslations("finance");
  const locale = (await getLocale()) as "ar" | "en";
  const format = await getFormatter();
  const result = await callRpc("finance_receipt", { p_transaction_id: transactionId });
  if (result.error) notFound();
  const r = receiptSchema.parse(result.data);

  return (
    <article className="mx-auto grid max-w-md gap-3 rounded-md border p-6 text-sm print:border-0">
      <h1 className="text-xl font-semibold">{r.clinic_name}</h1>
      <p className="font-medium">{t(r.kind === "payment" ? "receiptTitle" : "refundReceiptTitle")}</p>
      {r.reversed ? <p className="font-medium text-destructive">{t("reversedLabel")}</p> : null}
      <dl className="grid grid-cols-2 gap-1">
        <dt className="text-muted-foreground">{t("receiptNumber")}</dt>
        <dd dir="ltr">{r.id.slice(0, 8).toUpperCase()}</dd>
        <dt className="text-muted-foreground">{t("date")}</dt>
        <dd>{format.dateTime(new Date(r.posted_at), { dateStyle: "medium", timeStyle: "short" })}</dd>
        {r.patient_name ? (
          <>
            <dt className="text-muted-foreground">{t("patient")}</dt>
            <dd>
              {r.patient_name} #{r.chart_number}
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">{t("amount")}</dt>
        <dd dir="ltr" className="font-semibold">
          {formatEgp(r.amount_minor, locale)}
        </dd>
        {r.method ? (
          <>
            <dt className="text-muted-foreground">{t("method")}</dt>
            <dd>{t(`methods.${r.method}`)}</dd>
          </>
        ) : null}
        {r.reference ? (
          <>
            <dt className="text-muted-foreground">{t("reference")}</dt>
            <dd dir="ltr">{r.reference}</dd>
          </>
        ) : null}
      </dl>
      <p className="text-xs text-muted-foreground">{t("notTaxDocument")}</p>
    </article>
  );
}
