import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { enterRouteLocale } from "@/i18n/locale";
import { formatEgp } from "@/lib/money";
import {
  createPlan,
  decideManualPayment,
  publishPlanVersion,
  saveBillingSettings,
  setPlanVisibility,
} from "@/modules/billing/actions";
import { getPendingManualPayments, getPlanCatalog } from "@/modules/billing/queries";
import { getPlatformSettings } from "@/modules/messaging/queries";
import { requirePlatformAdmin } from "@/modules/platform-admin/guard";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** ADM-002 / SUB-010: plans, versions, manual payment verification and billing settings. */
export default async function AdminBillingPage({ params }: PageProps<"/[locale]/admin/billing">) {
  const locale = enterRouteLocale((await params).locale);
  await requirePlatformAdmin(locale);
  const t = await getTranslations("billing");
  const format = await getFormatter();
  const supabase = await createSupabaseServerClient();
  const [catalog, pending, settings, plans] = await Promise.all([
    getPlanCatalog(),
    getPendingManualPayments(),
    getPlatformSettings(),
    supabase.from("platform_plans").select("id, code, name_ar, name_en, is_public").order("created_at"),
  ]);
  const setting = (key: string, fallback: number) => {
    const v = settings.find((s) => s.key === key)?.value;
    return typeof v === "number" ? v : fallback;
  };
  const egp = (minor: number | null) => (minor === null ? "—" : formatEgp(minor, locale));
  const money = (name: string, label: string) => (
    <label className="grid gap-1 text-sm">
      {label}
      <Input name={name} inputMode="decimal" dir="ltr" placeholder="0.00" />
    </label>
  );

  return (
    <div className="grid max-w-5xl gap-4">
      <h1 className="text-2xl font-semibold">{t("adminTitle")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("pendingTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("pendingDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noPending")}</p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {pending.map((p) => (
                <li key={p.id} className="grid gap-2 p-3">
                  <span>
                    {format.dateTime(new Date(p.created_at), { dateStyle: "medium" })} · {egp(p.amount_minor)} ·{" "}
                    {p.source} · <span dir="ltr">{p.payer_reference}</span> ·{" "}
                    <a href={`/api/billing/evidence/${p.id}`} target="_blank" rel="noreferrer" className="underline">
                      {t("viewEvidence")}
                    </a>
                  </span>
                  <ActionForm action={decideManualPayment} className="sm:grid-cols-3 sm:items-end">
                    <input type="hidden" name="paymentId" value={p.id} />
                    <Input name="reason" maxLength={1000} placeholder={t("rejectReason")} className="sm:col-span-2" />
                    <span className="flex gap-2">
                      <SubmitButton size="sm" name="approve" value="true">
                        {t("approve")}
                      </SubmitButton>
                      <SubmitButton size="sm" variant="outline" name="approve" value="false">
                        {t("reject")}
                      </SubmitButton>
                    </span>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("plansTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("adminPlansDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {(plans.data ?? []).map((plan) => {
            const versions = catalog.all.filter((v) => v.plan_id === plan.id);
            return (
              <section key={plan.id} className="grid gap-2 rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {plan.name_en} / {plan.name_ar} · <span dir="ltr">{plan.code}</span>
                  </span>
                  <ActionForm action={setPlanVisibility}>
                    <input type="hidden" name="planId" value={plan.id} />
                    <input type="hidden" name="visible" value={plan.is_public ? "false" : "true"} />
                    <SubmitButton size="sm" variant="outline">
                      {plan.is_public ? t("hidePlan") : t("showPlan")}
                    </SubmitButton>
                  </ActionForm>
                </div>
                <ul className="grid gap-1 text-xs text-muted-foreground">
                  {versions.map((v) => (
                    <li key={v.id}>
                      v{v.version} · {t("doctors", { count: v.doctor_limit })} · {egp(v.monthly_price_minor)} /{" "}
                      {egp(v.annual_price_minor)} · {t("messagesIncluded", { count: v.messaging_allowance })}
                    </li>
                  ))}
                </ul>
                <details>
                  <summary className="cursor-pointer text-xs">{t("publishVersion")}</summary>
                  <ActionForm
                    action={publishPlanVersion}
                    className="mt-2 sm:grid-cols-3 sm:items-end"
                    successText={t("saved")}
                  >
                    <input type="hidden" name="planId" value={plan.id} />
                    <label className="grid gap-1 text-sm">
                      {t("doctorLimit")}
                      <Input name="doctorLimit" type="number" min={1} max={1000} required />
                    </label>
                    {money("monthly", t("monthlyPrice"))}
                    {money("annual", t("annualPrice"))}
                    {money("extraMonthly", t("extraMonthlyPrice"))}
                    {money("extraAnnual", t("extraAnnualPrice"))}
                    <label className="grid gap-1 text-sm">
                      {t("allowance")}
                      <Input name="allowance" type="number" min={0} defaultValue={0} />
                    </label>
                    {money("overage", t("overagePrice"))}
                    <div>
                      <SubmitButton size="sm">{t("publish")}</SubmitButton>
                    </div>
                  </ActionForm>
                </details>
              </section>
            );
          })}
          <ActionForm action={createPlan} className="sm:grid-cols-4 sm:items-end" successText={t("saved")}>
            <label className="grid gap-1 text-sm">
              {t("planCode")}
              <Input name="code" required dir="ltr" pattern="[a-z][a-z0-9_]{1,40}" />
            </label>
            <label className="grid gap-1 text-sm">
              {t("nameAr")}
              <Input name="nameAr" required maxLength={100} dir="rtl" />
            </label>
            <label className="grid gap-1 text-sm">
              {t("nameEn")}
              <Input name="nameEn" required maxLength={100} dir="ltr" />
            </label>
            <div>
              <SubmitButton size="sm" variant="outline">
                {t("createPlan")}
              </SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("settingsTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("settingsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveBillingSettings} className="sm:grid-cols-3 sm:items-end" successText={t("saved")}>
            <label className="grid gap-1 text-sm">
              {t("graceDays")}
              <Input name="graceDays" type="number" min={0} max={90} defaultValue={setting("billing.grace_days", 7)} />
            </label>
            <label className="grid gap-1 text-sm">
              {t("trialDoctors")}
              <Input
                name="trialDoctors"
                type="number"
                min={1}
                max={100}
                defaultValue={setting("billing.trial_doctor_limit", 3)}
              />
            </label>
            <div>
              <SubmitButton size="sm">{t("save")}</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
