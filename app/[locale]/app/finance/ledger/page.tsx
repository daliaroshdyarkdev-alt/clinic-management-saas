import { getLocale, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { enterRouteLocale } from "@/i18n/locale";
import { formatEgp } from "@/lib/money";
import { addDays, cairoToday, isDateKey } from "@/lib/time/dates";
import { reverseTransaction, submitDailyClose } from "@/modules/finance/actions";
import { getReport, getTransactions } from "@/modules/finance/queries";
import { getWorkspace } from "@/modules/tenancy/workspace";

export default async function LedgerPage({ params, searchParams }: PageProps<"/[locale]/app/finance/ledger">) {
  enterRouteLocale((await params).locale);
  const t = await getTranslations("finance");
  const locale = (await getLocale()) as "ar" | "en";
  const workspace = await getWorkspace();
  const clinic = workspace?.active;
  if (!workspace || !clinic) return null;
  const caps = workspace.capabilities;
  if (!caps.includes("finance.reports") && !caps.includes("finance.approve")) {
    return <p className="text-muted-foreground">{t("ledgerNoAccess")}</p>;
  }

  const query = await searchParams;
  const today = cairoToday();
  const from = isDateKey(query.from) ? query.from : addDays(today, -6);
  const to = isDateKey(query.to) ? query.to : today;
  const [transactions, report] = await Promise.all([
    getTransactions(clinic.clinicId, from, to),
    caps.includes("finance.reports") ? getReport(clinic.clinicId, from, to) : Promise.resolve(null),
  ]);
  const reversed = new Set(transactions.map((x) => x.reverses_transaction_id).filter(Boolean));
  const money = (m: number) => formatEgp(m, locale);
  const canReverse = caps.includes("finance.approve");

  return (
    <div className="grid gap-4">
      <form className="flex flex-wrap items-end gap-2 text-sm">
        <label className="grid gap-1">
          {t("from")}
          <Input type="date" name="from" defaultValue={from} />
        </label>
        <label className="grid gap-1">
          {t("to")}
          <Input type="date" name="to" defaultValue={to} />
        </label>
        <Button type="submit" variant="outline" size="sm">
          {t("show")}
        </Button>
        {caps.includes("finance.reports") ? (
          <a href={`/api/finance/export?from=${from}&to=${to}`} className="text-primary underline underline-offset-4">
            {t("exportCsv")}
          </a>
        ) : null}
      </form>

      {report ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="text-base">{t("balances")}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-1 text-sm">
                {report.balances.map((b) => (
                  <li key={b.account} className="flex justify-between gap-2">
                    <span>{b.account}</span>
                    <span dir="ltr">{money(b.balance_minor)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="text-base">{t("collectionsByMethod")}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-1 text-sm">
                {Object.entries(report.by_method).map(([m, v]) => (
                  <li key={m} className="flex justify-between gap-2">
                    <span>{t(`methods.${m as "cash"}`)}</span>
                    <span dir="ltr">{money(v)}</span>
                  </li>
                ))}
              </ul>
              <h3 className="mt-3 text-sm font-medium">{t("collectionsByDoctor")}</h3>
              <ul className="grid gap-1 text-sm">
                {report.by_doctor.map((d) => (
                  <li key={d.doctor} className="flex justify-between gap-2">
                    <span>{d.doctor}</span>
                    <span dir="ltr">{money(d.collections_minor)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>
                <h2 className="text-base">{t("byDay")}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-1 text-sm">
                {report.by_day.map((d) => (
                  <li key={d.date} className="flex flex-wrap justify-between gap-2">
                    <span>{d.date}</span>
                    <span>
                      {t("dayTotals", {
                        collections: money(d.totals.collections_minor ?? 0),
                        refunds: money(d.totals.refunds_minor ?? 0),
                        expenses: money(d.totals.expenses_minor ?? 0),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
              <ActionForm action={submitDailyClose} className="mt-3 flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-sm">
                  {t("dailyClose")}
                  <Input type="date" name="date" defaultValue={today} />
                </label>
                <SubmitButton size="sm" variant="outline">
                  {t("submitDailyClose")}
                </SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-base">{t("transactions")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {transactions.map((x) => (
              <li key={x.id} className="grid gap-2 py-2 md:grid-cols-[1fr_auto]">
                <div>
                  <p>
                    <span className="font-medium">{t(`txnKinds.${x.kind}`)}</span> ·{" "}
                    <span dir="ltr">{money(x.amount_minor)}</span>
                    {x.method ? ` · ${t(`methods.${x.method}`)}` : ""}
                    {reversed.has(x.id) ? ` · ${t("reversedLabel")}` : ""}
                  </p>
                  <p className="text-muted-foreground">
                    {x.business_date} · {[x.category, x.reference, x.description].filter(Boolean).join(" · ")}{" "}
                    <span dir="ltr" className="text-xs">
                      {x.id.slice(0, 8)}
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {x.kind === "payment" || x.kind === "refund" ? (
                    <a
                      href={`/${locale}/app/finance/receipts/${x.id}`}
                      target="_blank"
                      rel="noopener"
                      className="text-primary underline"
                    >
                      {t("receipt")}
                    </a>
                  ) : null}
                  {canReverse && x.kind !== "reversal" && !reversed.has(x.id) ? (
                    <details>
                      <summary className="cursor-pointer text-destructive">{t("reverse")}</summary>
                      <ActionForm action={reverseTransaction} className="mt-2">
                        <input type="hidden" name="transactionId" value={x.id} />
                        <Input name="reason" required maxLength={500} placeholder={t("reason")} />
                        <SubmitButton size="sm" variant="outline">
                          {t("reverseSubmit")}
                        </SubmitButton>
                      </ActionForm>
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
