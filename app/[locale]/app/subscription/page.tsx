import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { enterRouteLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { formatEgp } from "@/lib/money";
import { startOnlinePayment, submitManualPayment } from "@/modules/billing/actions";
import { paymentProvider } from "@/modules/billing/provider";
import {
  getBillingStatus,
  getPayments,
  getPlanCatalog,
  getReceipts,
  getReverificationRequests,
} from "@/modules/billing/queries";
import { getWorkspace } from "@/modules/tenancy/workspace";

export default async function SubscriptionPage({ params }: PageProps<"/[locale]/app/subscription">) {
  const locale = enterRouteLocale((await params).locale);
  const t = await getTranslations("billing");
  const to = await getTranslations("onboarding");
  const format = await getFormatter();
  const clinic = (await getWorkspace())?.active;
  if (!clinic) return null;
  if (clinic.role !== "owner") return <p className="text-muted-foreground">{t("ownerOnly")}</p>;

  const [status, catalog, payments, receipts, reverifications] = await Promise.all([
    getBillingStatus(clinic.clinicId),
    getPlanCatalog(),
    getPayments(clinic.clinicId),
    getReceipts(clinic.clinicId),
    getReverificationRequests(clinic.clinicId),
  ]);
  const online = paymentProvider(locale) !== null;
  const date = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { dateStyle: "medium" }) : "—");
  const egp = (minor: number | null) => (minor === null ? "—" : formatEgp(minor, locale));
  const planName = (id: string | null) => {
    const v = catalog.all.find((x) => x.id === id);
    return v ? `${locale === "ar" ? v.plan.name_ar : v.plan.name_en} (v${v.version})` : "—";
  };
  const receiptFor = new Map(receipts.map((r) => [r.payment_id, r]));
  const select = "h-9 rounded-md border border-input bg-background px-2";
  const choice = (
    <>
      <label className="grid gap-1 text-sm">
        {t("plan")}
        <select name="versionId" required className={select}>
          {catalog.current.map((v) => (
            <option key={v.id} value={v.id}>
              {planName(v.id)} · {t("doctors", { count: v.doctor_limit })}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        {t("period")}
        <select name="period" className={select}>
          <option value="monthly">{t("monthly")}</option>
          <option value="annual">{t("annual")}</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        {t("extraDoctors")}
        <Input name="extra" type="number" min={0} max={100} defaultValue={0} />
      </label>
    </>
  );

  return (
    <div className="grid max-w-4xl gap-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      {reverifications.length > 0 ? (
        <Card className="border-warning">
          <CardContent className="grid gap-1 pt-6 text-sm">
            {reverifications.map((r) => (
              <p key={r.id}>
                {t("reverificationRequested", { type: to(`types.${r.license_type as "clinic_operating"}`) })} —{" "}
                {r.reason}{" "}
                <Link href="/app/onboarding" className="underline">
                  {t("uploadNewRevision")}
                </Link>
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("statusTitle")}</h2>
          </CardTitle>
          {status ? (
            <CardDescription>{t(`stateHelp.${status.state}`, { days: status.grace_days })}</CardDescription>
          ) : null}
        </CardHeader>
        {status ? (
          <CardContent className="grid gap-1 text-sm">
            <p className="font-medium">{t(`states.${status.state}`)}</p>
            {status.state === "trial" ? <p>{t("trialEnds", { date: date(status.trial_ends_at) })}</p> : null}
            {status.period_end ? (
              <p>{t("currentPeriod", { plan: planName(status.plan_version_id), end: date(status.period_end) })}</p>
            ) : null}
            {status.next_period_start ? (
              <p>
                {t("nextPeriod", {
                  plan: planName(status.next_plan_version_id),
                  start: date(status.next_period_start),
                })}
              </p>
            ) : null}
            <p>{t("capacity", { active: status.active_doctors, capacity: status.doctor_capacity })}</p>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("plansTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("plansDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {catalog.current.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noPlans")}</p>
          ) : (
            <>
              <ul className="grid gap-2 sm:grid-cols-2">
                {catalog.current.map((v) => (
                  <li key={v.id} className="rounded-md border p-3 text-sm">
                    <p className="font-medium">{planName(v.id)}</p>
                    <p>{t("doctors", { count: v.doctor_limit })}</p>
                    <p>
                      {t("monthly")}: {egp(v.monthly_price_minor)} · {t("annual")}: {egp(v.annual_price_minor)}
                    </p>
                    <p>{t("messagesIncluded", { count: v.messaging_allowance })}</p>
                  </li>
                ))}
              </ul>
              {online ? (
                <ActionForm action={startOnlinePayment} className="sm:grid-cols-3 sm:items-end">
                  {choice}
                  <div>
                    <SubmitButton>{t("payOnline")}</SubmitButton>
                  </div>
                </ActionForm>
              ) : (
                <p className="text-sm text-muted-foreground">{t("onlineUnavailable")}</p>
              )}
              <details>
                <summary className="cursor-pointer text-sm">{t("manualTitle")}</summary>
                <ActionForm
                  action={submitManualPayment}
                  className="mt-3 sm:grid-cols-3 sm:items-end"
                  successText={t("manualSubmitted")}
                >
                  {choice}
                  <label className="grid gap-1 text-sm">
                    {t("source")}
                    <select name="source" className={select}>
                      <option value="instapay">InstaPay</option>
                      <option value="bank_transfer">{t("bankTransfer")}</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    {t("payerReference")}
                    <Input name="reference" required maxLength={200} dir="ltr" />
                  </label>
                  <label className="grid gap-1 text-sm">
                    {t("evidence")}
                    <Input name="file" type="file" required accept="application/pdf,image/jpeg,image/png" />
                  </label>
                  <p className="text-xs text-muted-foreground sm:col-span-3">{t("manualHint")}</p>
                  <div>
                    <SubmitButton variant="outline">{t("submitManual")}</SubmitButton>
                  </div>
                </ActionForm>
              </details>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("historyTitle")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noPayments")}</p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {payments.map((p) => {
                const receipt = receiptFor.get(p.id);
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                    <span>
                      {date(p.created_at)} · {planName(p.plan_version_id)} · {t(p.billing_period)} ·{" "}
                      {egp(p.amount_minor)} · {t(`paymentStatus.${p.status}`)}
                      {p.decision_reason ? ` — ${p.decision_reason}` : ""}
                    </span>
                    {receipt ? (
                      <Link href={`/app/subscription/receipts/${receipt.id}`} className="underline">
                        {t("receipt", { number: receipt.receipt_number })}
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
