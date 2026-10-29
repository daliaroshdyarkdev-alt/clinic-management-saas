import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { MoneyInput } from "@/components/finance/money-input";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { enterRouteLocale } from "@/i18n/locale";
import { formatEgp } from "@/lib/money";
import {
  acknowledgeHandover,
  closeSession,
  createHandover,
  openSession,
  submitRequest,
} from "@/modules/finance/actions";
import { getAccounts, getHandovers, getMemberNames, getMySessions } from "@/modules/finance/queries";
import { getWorkspace } from "@/modules/tenancy/workspace";
import { PaymentForm } from "./payment-form";

/** Cashier desk: session, payments, expense/transfer/refund requests, handovers. */
export default async function FinanceDeskPage({ params }: PageProps<"/[locale]/app/finance">) {
  enterRouteLocale((await params).locale);
  const t = await getTranslations("finance");
  const locale = (await getLocale()) as "ar" | "en";
  const format = await getFormatter();
  const workspace = await getWorkspace();
  const clinic = workspace?.active;
  if (!workspace || !clinic) return null;
  if (!workspace.capabilities.includes("finance.collect"))
    return <p className="text-muted-foreground">{t("deskNoAccess")}</p>;

  const [accounts, sessions, handovers, recipients] = await Promise.all([
    getAccounts(clinic.clinicId),
    getMySessions(clinic.clinicId, workspace.user.id),
    getHandovers(clinic.clinicId),
    getMemberNames(clinic.clinicId),
  ]);
  const active = accounts.filter((a) => a.status === "active");
  const drawers = active.filter((a) => a.account_type === "cash_drawer");
  const open = sessions.find((s) => s.status === "open");
  const lastClosed = sessions.find((s) => s.status !== "open");
  const money = (minor: number | null) => (minor === null ? "—" : formatEgp(minor, locale));
  const incoming = handovers.filter((h) => h.to_user_id === workspace.user.id && !h.acknowledged_at);
  const select = "h-9 rounded-md border border-input bg-background px-2";

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("sessionTitle")}</h2>
          </CardTitle>
          {open ? (
            <CardDescription>
              {t("sessionOpenSince", { date: format.dateTime(new Date(open.opened_at), { timeStyle: "short" }) })} ·{" "}
              {t("openingCount")}: {money(open.opening_count_minor)}
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          {open ? (
            <ActionForm action={closeSession} className="sm:grid-cols-3 sm:items-end" successText={t("sessionClosed")}>
              <MoneyInput name="counted" label={t("countedCash")} />
              <label className="grid gap-1 text-sm">
                {t("explanation")}
                <Input name="explanation" maxLength={1000} />
              </label>
              <div>
                <SubmitButton variant="outline">{t("closeSession")}</SubmitButton>
              </div>
            </ActionForm>
          ) : drawers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noDrawer")}</p>
          ) : (
            <ActionForm action={openSession} className="sm:grid-cols-3 sm:items-end">
              <label className="grid gap-1 text-sm">
                {t("drawer")}
                <select name="accountId" className={select}>
                  {drawers.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <MoneyInput name="openingCount" label={t("openingCount")} />
              <div>
                <SubmitButton>{t("openSession")}</SubmitButton>
              </div>
            </ActionForm>
          )}
          {lastClosed && !open ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {t("lastSession", {
                status: t(`sessionStatus.${lastClosed.status}`),
                expected: money(lastClosed.expected_minor),
                counted: money(lastClosed.counted_minor),
                discrepancy: money(lastClosed.discrepancy_minor),
              })}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {open ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="text-lg">{t("paymentTitle")}</h2>
              </CardTitle>
              <CardDescription>{t("paymentDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <PaymentForm accounts={active.map((a) => ({ id: a.id, name: a.name }))} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="text-lg">{t("requestTitle")}</h2>
              </CardTitle>
              <CardDescription>{t("requestDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={submitRequest} className="sm:grid-cols-3 sm:items-end" successText={t("requestSent")}>
                <label className="grid gap-1 text-sm">
                  {t("requestKind")}
                  <select name="kind" className={select}>
                    {(["expense", "transfer", "refund"] as const).map((k) => (
                      <option key={k} value={k}>
                        {t(`kinds.${k}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <MoneyInput label={t("amount")} />
                <label className="grid gap-1 text-sm">
                  {t("fromAccount")}
                  <select name="fromAccountId" className={select}>
                    {active.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  {t("toAccount")}
                  <select name="toAccountId" className={select}>
                    <option value="">—</option>
                    {active.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  {t("category")}
                  <Input name="category" maxLength={100} />
                </label>
                <label className="grid gap-1 text-sm">
                  {t("originalPayment")}
                  <Input name="originalId" dir="ltr" placeholder={t("originalPaymentHint")} />
                </label>
                <label className="grid gap-1 text-sm sm:col-span-2">
                  {t("description")}
                  <Input name="description" maxLength={500} />
                </label>
                <div>
                  <SubmitButton variant="outline">{t("submitRequest")}</SubmitButton>
                </div>
              </ActionForm>
            </CardContent>
          </Card>
        </>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("handoverTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("handoverDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {lastClosed && !open ? (
            <ActionForm
              action={createHandover}
              className="sm:grid-cols-4 sm:items-end"
              successText={t("handoverCreated")}
            >
              <input type="hidden" name="sessionId" value={lastClosed.id} />
              <MoneyInput label={t("amount")} />
              <label className="grid gap-1 text-sm">
                {t("recipient")}
                <select name="toUserId" className={select}>
                  {recipients.map((r) => (
                    <option key={r.user_id} value={r.user_id}>
                      {r.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                {t("toAccount")}
                <select name="toAccountId" className={select}>
                  {active
                    .filter(
                      (a) =>
                        a.id !== lastClosed.cash_account_id && a.account_type !== "pos" && a.account_type !== "wallet",
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <div>
                <SubmitButton variant="outline">{t("createHandover")}</SubmitButton>
              </div>
            </ActionForm>
          ) : null}
          {incoming.map((h) => (
            <ActionForm key={h.id} action={acknowledgeHandover} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="handoverId" value={h.id} />
              <span className="text-sm">{t("incomingHandover", { amount: money(h.amount_minor) })}</span>
              <SubmitButton size="sm">{t("acknowledge")}</SubmitButton>
            </ActionForm>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
