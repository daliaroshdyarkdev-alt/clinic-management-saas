import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { z } from "zod";
import { enterRouteLocale } from "@/i18n/locale";
import { formatEgp } from "@/lib/money";
import { getReceipt } from "@/modules/billing/queries";
import { getWorkspace } from "@/modules/tenancy/workspace";

/** SUB-009: printable payment receipt (not a tax invoice; OD-L04). RLS limits it to the owner. */
export default async function ReceiptPage({ params }: PageProps<"/[locale]/app/subscription/receipts/[receiptId]">) {
  const { locale: raw, receiptId } = await params;
  const locale = enterRouteLocale(raw);
  if (!z.uuid().safeParse(receiptId).success) notFound();
  const clinic = (await getWorkspace())?.active;
  const receipt = await getReceipt(receiptId);
  if (!clinic || !receipt) notFound();
  const t = await getTranslations("billing");
  const format = await getFormatter();
  return (
    <article className="mx-auto grid max-w-md gap-2 rounded-md border p-6 text-sm print:border-0">
      <h1 className="text-xl font-semibold">{t("receiptTitle")}</h1>
      <p>{t("receipt", { number: receipt.receipt_number })}</p>
      <p>{clinic.name}</p>
      <p>{format.dateTime(new Date(receipt.issued_at), { dateStyle: "long", timeStyle: "short" })}</p>
      <p className="text-lg font-medium">{formatEgp(receipt.amount_minor, locale)}</p>
      <p className="text-xs text-muted-foreground">{t("notTaxInvoice")}</p>
    </article>
  );
}
