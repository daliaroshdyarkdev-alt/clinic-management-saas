import { getTranslations } from "next-intl/server";
import { MoneyInput } from "@/components/finance/money-input";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { enterRouteLocale } from "@/i18n/locale";
import { createAccount, savePolicies, setFinancePermission, submitOpeningBalance } from "@/modules/finance/actions";
import { getAccounts, getPolicies } from "@/modules/finance/queries";
import { getWorkspace } from "@/modules/tenancy/workspace";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const GRANTS = [
  ["manager", "finance.collect"],
  ["manager", "finance.approve"],
  ["manager", "finance.reports"],
  ["manager", "finance.accounts"],
  ["receptionist", "finance.collect"],
  ["cashier", "finance.reports"],
] as const;

export default async function FinanceSetupPage({ params }: PageProps<"/[locale]/app/finance/setup">) {
  enterRouteLocale((await params).locale);
  const t = await getTranslations("finance");
  const workspace = await getWorkspace();
  const clinic = workspace?.active;
  if (!workspace || !clinic) return null;
  const isOwner = clinic.role === "owner";
  if (!isOwner && !workspace.capabilities.includes("finance.accounts"))
    return <p className="text-muted-foreground">{t("setupNoAccess")}</p>;

  const [accounts, policies] = await Promise.all([getAccounts(clinic.clinicId), getPolicies(clinic.clinicId)]);
  let grants = new Set<string>();
  if (isOwner) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("clinic_role_permissions")
      .select("role, capability, allowed")
      .eq("clinic_id", clinic.clinicId);
    grants = new Set((data ?? []).filter((r) => r.allowed).map((r) => `${r.role}:${r.capability}`));
  }
  const select = "h-9 rounded-md border border-input bg-background px-2";
  const policySelect = (name: string, value: string | undefined, options: readonly string[]) => (
    <select name={name} defaultValue={value} className={select}>
      {options.map((o) => (
        <option key={o} value={o}>
          {t(`policyOptions.${o as "direct"}`)}
        </option>
      ))}
    </select>
  );
  const approval = ["direct", "all_approval", "threshold"] as const;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("accountsTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("accountsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ul className="divide-y rounded-md border text-sm">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                <span>
                  {a.name} · {t(`accountTypes.${a.account_type}`)} · {t(`accountStatus.${a.status}`)}
                </span>
                {a.status === "pending_opening" ? (
                  <ActionForm action={submitOpeningBalance} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="accountId" value={a.id} />
                    <MoneyInput label={t("openingBalance")} />
                    <SubmitButton size="sm" variant="outline">
                      {t("submitForApproval")}
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
          <ActionForm action={createAccount} className="sm:grid-cols-3 sm:items-end">
            <label className="grid gap-1 text-sm">
              {t("accountName")}
              <Input name="name" required minLength={2} maxLength={100} />
            </label>
            <label className="grid gap-1 text-sm">
              {t("accountType")}
              <select name="type" className={select}>
                {(["cash_drawer", "safe", "bank", "pos", "wallet"] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`accountTypes.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <SubmitButton size="sm">{t("createAccount")}</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      {isOwner ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="text-lg">{t("policiesTitle")}</h2>
              </CardTitle>
              <CardDescription>{policies ? t("policiesDescription") : t("policiesDefault")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={savePolicies} className="sm:grid-cols-2" successText={t("saved")}>
                {(["expense", "transfer", "refund"] as const).map((k) => (
                  <div key={k} className="grid gap-1 text-sm">
                    {t(`policyLabels.${k}`)}
                    {policySelect(k, policies?.[`${k}_policy`] as string | undefined, approval)}
                    <Input name={`${k}Threshold`} inputMode="decimal" dir="ltr" placeholder={t("thresholdHint")} />
                  </div>
                ))}
                <label className="grid gap-1 text-sm">
                  {t("policyLabels.discrepancy")}
                  {policySelect("discrepancy", policies?.discrepancy_policy as string | undefined, [
                    "warning",
                    "explanation_required",
                    "approval_required",
                  ])}
                </label>
                <label className="grid gap-1 text-sm">
                  {t("policyLabels.daily")}
                  {policySelect("daily", policies?.daily_closing_policy as string | undefined, [
                    "sessions_only",
                    "daily_close_required",
                    "daily_close_approval",
                  ])}
                </label>
                <div>
                  <SubmitButton>{t("savePolicies")}</SubmitButton>
                </div>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="text-lg">{t("permissionsTitle")}</h2>
              </CardTitle>
              <CardDescription>{t("permissionsDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {GRANTS.map(([role, capability]) => {
                const on = grants.has(`${role}:${capability}`);
                return (
                  <ActionForm
                    key={`${role}:${capability}`}
                    action={setFinancePermission}
                    className="flex flex-wrap items-center gap-3"
                  >
                    <input type="hidden" name="role" value={role} />
                    <input type="hidden" name="capability" value={capability} />
                    <input type="hidden" name="allowed" value={on ? "false" : "true"} />
                    <span className="text-sm">
                      {t("permissionLine", { role: t(`roles.${role}`), capability: t(`capabilities.${capability}`) })}:{" "}
                      <strong>{on ? t("on") : t("off")}</strong>
                    </span>
                    <SubmitButton size="sm" variant="outline">
                      {on ? t("turnOff") : t("turnOn")}
                    </SubmitButton>
                  </ActionForm>
                );
              })}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
