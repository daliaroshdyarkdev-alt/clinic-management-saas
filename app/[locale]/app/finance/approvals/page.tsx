import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { enterRouteLocale } from "@/i18n/locale";
import { formatEgp } from "@/lib/money";
import {
  acknowledgeHandover,
  approveDailyClose,
  approveSession,
  decideOpeningBalance,
  decideRequest,
} from "@/modules/finance/actions";
import {
  getAccounts,
  getDailyClosings,
  getHandovers,
  getOpenRequests,
  getPendingOpeningBalances,
  getSessionsPendingApproval,
} from "@/modules/finance/queries";
import { getWorkspace } from "@/modules/tenancy/workspace";

export default async function FinanceApprovalsPage({ params }: PageProps<"/[locale]/app/finance/approvals">) {
  enterRouteLocale((await params).locale);
  const t = await getTranslations("finance");
  const locale = (await getLocale()) as "ar" | "en";
  const format = await getFormatter();
  const workspace = await getWorkspace();
  const clinic = workspace?.active;
  if (!workspace || !clinic) return null;
  const isOwner = clinic.role === "owner";
  const canApprove = workspace.capabilities.includes("finance.approve");
  if (!canApprove && !isOwner) return <p className="text-muted-foreground">{t("approvalsNoAccess")}</p>;

  const [requests, sessions, openings, accounts, closings, handovers] = await Promise.all([
    getOpenRequests(clinic.clinicId),
    getSessionsPendingApproval(clinic.clinicId),
    isOwner ? getPendingOpeningBalances(clinic.clinicId) : Promise.resolve([]),
    getAccounts(clinic.clinicId),
    getDailyClosings(clinic.clinicId),
    getHandovers(clinic.clinicId),
  ]);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const money = (m: number | null) => (m === null ? "—" : formatEgp(m, locale));
  const pendingCloses = closings.filter((c) => c.status === "submitted");
  const incoming = handovers.filter((h) => h.to_user_id === workspace.user.id && !h.acknowledged_at);
  const empty = !requests.length && !sessions.length && !openings.length && !pendingCloses.length && !incoming.length;

  return (
    <div className="grid gap-4">
      {empty ? <p className="text-muted-foreground">{t("nothingToApprove")}</p> : null}
      {incoming.map((h) => (
        <ActionForm key={h.id} action={acknowledgeHandover} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="handoverId" value={h.id} />
          <span className="text-sm">{t("incomingHandover", { amount: money(h.amount_minor) })}</span>
          <SubmitButton size="sm">{t("acknowledge")}</SubmitButton>
        </ActionForm>
      ))}
      {requests.map((r) => (
        <Card key={r.id}>
          <CardHeader>
            <CardTitle>
              <h2 className="text-base">
                {t(`kinds.${r.kind}`)} · {money(r.amount_minor)}
              </h2>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {[r.category, r.description].filter(Boolean).join(" · ")} ·{" "}
              {format.dateTime(new Date(r.submitted_at), { dateStyle: "medium", timeStyle: "short" })}
            </p>
          </CardHeader>
          <CardContent>
            <ActionForm action={decideRequest} className="sm:grid-cols-3 sm:items-end">
              <input type="hidden" name="requestId" value={r.id} />
              <label className="grid gap-1 text-sm sm:col-span-2">
                {t("reason")}
                <Input name="reason" maxLength={500} />
              </label>
              <div className="flex gap-2">
                <SubmitButton size="sm" name="approve" value="true">
                  {t("approve")}
                </SubmitButton>
                <SubmitButton size="sm" variant="outline" name="approve" value="false">
                  {t("reject")}
                </SubmitButton>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ))}
      {sessions.map((s) => (
        <ActionForm
          key={s.id}
          action={approveSession}
          className="flex flex-wrap items-center gap-3 rounded-md border p-3"
        >
          <input type="hidden" name="sessionId" value={s.id} />
          <span className="text-sm">
            {t("sessionDiscrepancy", {
              expected: money(s.expected_minor),
              counted: money(s.counted_minor),
              discrepancy: money(s.discrepancy_minor),
            })}
            {s.explanation ? ` · ${s.explanation}` : ""}
          </span>
          <SubmitButton size="sm">{t("approve")}</SubmitButton>
        </ActionForm>
      ))}
      {openings.map((o) => (
        <ActionForm
          key={o.id}
          action={decideOpeningBalance}
          className="flex flex-wrap items-center gap-3 rounded-md border p-3"
        >
          <input type="hidden" name="requestId" value={o.id} />
          <span className="text-sm">
            {t("openingBalanceFor", { account: accountName.get(o.account_id) ?? "", amount: money(o.amount_minor) })}
          </span>
          <SubmitButton size="sm" name="approve" value="true">
            {t("approve")}
          </SubmitButton>
          <SubmitButton size="sm" variant="outline" name="approve" value="false">
            {t("reject")}
          </SubmitButton>
        </ActionForm>
      ))}
      {canApprove
        ? pendingCloses.map((c) => (
            <ActionForm
              key={c.business_date}
              action={approveDailyClose}
              className="flex flex-wrap items-center gap-3 rounded-md border p-3"
            >
              <input type="hidden" name="date" value={c.business_date} />
              <span className="text-sm">
                {t("dailyCloseFor", { date: c.business_date, collections: money(c.totals.collections_minor ?? 0) })}
              </span>
              <SubmitButton size="sm">{t("approve")}</SubmitButton>
            </ActionForm>
          ))
        : null}
    </div>
  );
}
