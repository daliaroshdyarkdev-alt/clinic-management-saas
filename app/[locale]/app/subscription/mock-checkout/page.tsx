import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { enterRouteLocale } from "@/i18n/locale";
import { formatEgp } from "@/lib/money";
import { simulateMockPayment } from "@/modules/billing/actions";
import { paymentProvider } from "@/modules/billing/provider";

/** Development-only stand-in for a gateway checkout page (OD-P02). */
export default async function MockCheckoutPage({
  params,
  searchParams,
}: PageProps<"/[locale]/app/subscription/mock-checkout">) {
  const locale = enterRouteLocale((await params).locale);
  if (!paymentProvider(locale)) notFound();
  const { ref, amount } = await searchParams;
  if (typeof ref !== "string" || typeof amount !== "string" || !/^\d+$/.test(amount)) notFound();
  const t = await getTranslations("billing");
  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>
          <h1 className="text-lg">{t("mockCheckoutTitle")}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p>{formatEgp(Number(amount), locale)}</p>
        <div className="flex gap-2">
          {(["paid", "failed"] as const).map((status) => (
            <ActionForm key={status} action={simulateMockPayment}>
              <input type="hidden" name="ref" value={ref} />
              <input type="hidden" name="amount" value={amount} />
              <input type="hidden" name="status" value={status} />
              <SubmitButton variant={status === "paid" ? "default" : "outline"}>
                {status === "paid" ? t("simulatePaid") : t("simulateFailed")}
              </SubmitButton>
            </ActionForm>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
