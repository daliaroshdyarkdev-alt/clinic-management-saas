import { getFormatter, getTranslations } from "next-intl/server";
import { MoneyInput } from "@/components/finance/money-input";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { enterRouteLocale } from "@/i18n/locale";
import { formatEgp } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  acknowledgeAlert,
  configureConnection,
  requestTemplateOverride,
  saveNotificationSettings,
  setCeiling,
  setMessagingPermission,
} from "@/modules/messaging/actions";
import { getMessagingOverview, getOverrides, getTemplates } from "@/modules/messaging/queries";
import { getWorkspace } from "@/modules/tenancy/workspace";

const EVENTS = [
  "request_received",
  "request_decision",
  "alternative_proposal",
  "reminder",
  "cancellation",
  "session_cancellation",
  "no_show",
] as const;

const GRANTS = [
  ["receptionist", "messaging.send"],
  ["manager", "messaging.send"],
  ["manager", "messaging.budget"],
] as const;

type Kind =
  | "budget_80"
  | "budget_100"
  | "budget_blocked"
  | "send_failed"
  | "config_blocked"
  | "connection_down"
  | "connection_restored"
  | "patient_reply";

export default async function WhatsAppPage({ params }: PageProps<"/[locale]/app/whatsapp">) {
  const locale = enterRouteLocale((await params).locale);
  const t = await getTranslations("whatsapp");
  const format = await getFormatter();
  const workspace = await getWorkspace();
  const clinic = workspace?.active;
  if (!workspace || !clinic) return null;
  const isOwner = clinic.role === "owner";
  const caps = workspace.capabilities;
  const canView =
    isOwner ||
    caps.includes("appointments.manage") ||
    caps.includes("messaging.send") ||
    caps.includes("messaging.budget");
  if (!canView) return <p className="text-muted-foreground">{t("noAccess")}</p>;
  const canBudget = isOwner || caps.includes("messaging.budget");

  const [overview, templates, overrides] = await Promise.all([
    getMessagingOverview(clinic.clinicId),
    isOwner ? getTemplates() : Promise.resolve([]),
    isOwner ? getOverrides(clinic.clinicId) : Promise.resolve([]),
  ]);
  let grants = new Set<string>();
  if (isOwner) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("clinic_role_permissions")
      .select("role, capability, allowed")
      .eq("clinic_id", clinic.clinicId);
    grants = new Set((data ?? []).filter((r) => r.allowed).map((r) => `${r.role}:${r.capability}`));
  }
  const { settings, connection, intents, alerts, budget, ceilingMinor } = overview;
  const select = "h-9 rounded-md border border-input bg-background px-2";
  const dateTime = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="grid max-w-5xl gap-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      {alerts.length > 0 ? (
        <Card className="border-warning">
          <CardHeader>
            <CardTitle>
              <h2 className="text-lg">{t("alertsTitle")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border text-sm">
              {alerts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                  <span>
                    {t(`alerts.${a.kind as Kind}`)} · {dateTime(a.created_at)}
                  </span>
                  <ActionForm action={acknowledgeAlert}>
                    <input type="hidden" name="alertId" value={a.id} />
                    <SubmitButton size="sm" variant="outline">
                      {t("acknowledge")}
                    </SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("connectionTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("connectionDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {connection ? (
            <p>
              {t(`ownership.${connection.ownership_mode}`)} ·{" "}
              <span dir="ltr">{connection.display_phone ?? connection.phone_number_id}</span> ·{" "}
              <strong>{t(`connectionStatus.${connection.status}`)}</strong>
              {connection.last_checked_at ? ` · ${dateTime(connection.last_checked_at)}` : ""}
            </p>
          ) : (
            <p className="text-muted-foreground">{t("noConnection")}</p>
          )}
          {isOwner && connection?.ownership_mode !== "platform_managed" ? (
            <ActionForm action={configureConnection} className="sm:grid-cols-3 sm:items-end" successText={t("saved")}>
              <label className="grid gap-1">
                {t("phoneNumberId")}
                <Input
                  name="phoneNumberId"
                  required
                  dir="ltr"
                  pattern="[0-9]{5,30}"
                  defaultValue={connection?.phone_number_id}
                />
              </label>
              <label className="grid gap-1">
                {t("displayPhone")}
                <Input name="displayPhone" dir="ltr" maxLength={30} defaultValue={connection?.display_phone ?? ""} />
              </label>
              <label className="grid gap-1">
                {t("credentialRef")}
                <Input
                  name="credentialRef"
                  required
                  dir="ltr"
                  pattern="[A-Za-z0-9_]{3,64}"
                  defaultValue={connection?.credential_ref}
                />
              </label>
              <p className="text-xs text-muted-foreground sm:col-span-3">{t("credentialHint")}</p>
              <div>
                <SubmitButton size="sm">{t("saveConnection")}</SubmitButton>
              </div>
            </ActionForm>
          ) : null}
        </CardContent>
      </Card>

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-lg">{t("settingsTitle")}</h2>
            </CardTitle>
            <CardDescription>{t("settingsDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={saveNotificationSettings} successText={t("saved")}>
              <fieldset className="grid gap-1 text-sm sm:grid-cols-2">
                <legend className="mb-1 font-medium">{t("events")}</legend>
                {EVENTS.map((e) => (
                  <label key={e} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="events"
                      value={e}
                      defaultChecked={settings?.enabled_events.includes(e) ?? false}
                    />
                    {t(`eventNames.${e}`)}
                  </label>
                ))}
              </fieldset>
              <label className="grid gap-1 text-sm">
                {t("reminderOffsets")}
                <Input
                  name="offsets"
                  dir="ltr"
                  defaultValue={settings?.reminder_offsets_minutes.join(", ") ?? "1440"}
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t("defaultLanguage")}
                <select name="language" defaultValue={settings?.default_language ?? "ar"} className={select}>
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </label>
              <div>
                <SubmitButton size="sm">{t("saveSettings")}</SubmitButton>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      {canBudget ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-lg">{t("budgetTitle")}</h2>
            </CardTitle>
            <CardDescription>{t("budgetDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p>
              {budget
                ? t("budgetUsage", { used: budget.used_count, allowance: budget.allowance_count })
                : t("budgetNone")}
              {budget && budget.overage_spent_minor > 0
                ? ` · ${t("overageSpent", { amount: formatEgp(budget.overage_spent_minor, locale) })}`
                : ""}
            </p>
            <p>{ceilingMinor === null ? t("noCeiling") : t("ceiling", { amount: formatEgp(ceilingMinor, locale) })}</p>
            <ActionForm action={setCeiling} className="sm:grid-cols-3 sm:items-end" successText={t("saved")}>
              <MoneyInput label={t("ceilingLabel")} />
              <div>
                <SubmitButton size="sm">{t("saveCeiling")}</SubmitButton>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-lg">{t("permissionsTitle")}</h2>
            </CardTitle>
            <CardDescription>{t("permissionsDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border text-sm">
              {GRANTS.map(([role, capability]) => {
                const on = grants.has(`${role}:${capability}`);
                return (
                  <li key={`${role}:${capability}`} className="flex flex-wrap items-center justify-between gap-2 p-2">
                    <span>{t(`grants.${role}:${capability}` as "grants.manager:messaging.send")}</span>
                    <ActionForm action={setMessagingPermission}>
                      <input type="hidden" name="role" value={role} />
                      <input type="hidden" name="capability" value={capability} />
                      <input type="hidden" name="allowed" value={on ? "false" : "true"} />
                      <SubmitButton size="sm" variant="outline">
                        {on ? t("revoke") : t("grant")}
                      </SubmitButton>
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-lg">{t("templatesTitle")}</h2>
            </CardTitle>
            <CardDescription>{t("templatesDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border text-sm">
              {templates.map((tpl) => {
                const own = overrides.find((o) => o.catalog_id === tpl.id);
                return (
                  <li key={tpl.id} className="grid gap-2 p-2">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">
                        {t(`templateNames.${tpl.template_key as "reminder"}`)} · {tpl.language.toUpperCase()}
                      </span>
                      <span>{tpl.approved ? t("approved") : t("notApproved")}</span>
                    </div>
                    <p dir={tpl.language === "ar" ? "rtl" : "ltr"} className="text-muted-foreground">
                      {own?.body_preview ?? tpl.body_preview}
                    </p>
                    {own ? <p className="text-xs">{t(`overrideStatus.${own.status}`)}</p> : null}
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">{t("customise")}</summary>
                      <ActionForm
                        action={requestTemplateOverride}
                        className="mt-2"
                        successText={t("overrideRequested")}
                      >
                        <input type="hidden" name="catalogId" value={tpl.id} />
                        <Input
                          name="name"
                          required
                          dir="ltr"
                          pattern="[a-z0-9_]{1,250}"
                          placeholder={t("providerTemplateName")}
                        />
                        <textarea
                          name="body"
                          required
                          maxLength={1024}
                          rows={3}
                          className="rounded-md border border-input bg-background p-2"
                        />
                        <div>
                          <SubmitButton size="sm" variant="outline">
                            {t("requestApproval")}
                          </SubmitButton>
                        </div>
                      </ActionForm>
                    </details>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("logTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("logDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {intents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("logEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-start text-muted-foreground">
                    <th className="p-2 text-start">{t("when")}</th>
                    <th className="p-2 text-start">{t("template")}</th>
                    <th className="p-2 text-start">{t("recipient")}</th>
                    <th className="p-2 text-start">{t("status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {intents.map((m) => (
                    <tr key={m.id} className="border-t">
                      <td className="p-2">{dateTime(m.scheduled_for)}</td>
                      <td className="p-2">
                        {t(`templateNames.${m.template_key as "reminder"}`)}
                        {m.manual ? ` · ${t("manual")}` : ""}
                      </td>
                      <td className="p-2" dir="ltr">
                        {m.recipient_phone_e164}
                      </td>
                      <td className="p-2">
                        {t(`statuses.${m.status as "queued"}`)}
                        {m.billing_kind === "overage" ? ` · ${t("overage")}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
