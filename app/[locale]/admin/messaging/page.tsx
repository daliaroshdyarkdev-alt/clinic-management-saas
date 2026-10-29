import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { enterRouteLocale } from "@/i18n/locale";
import { configurePlatformNumber, reviewTemplate, savePlatformMessagingSettings } from "@/modules/messaging/actions";
import { getOverrides, getPlatformSettings, getTemplates } from "@/modules/messaging/queries";
import { requirePlatformAdmin } from "@/modules/platform-admin/guard";

/** WAP-001/004 and OD-B05: platform template approval and messaging terms. */
export default async function AdminMessagingPage({ params }: PageProps<"/[locale]/admin/messaging">) {
  const locale = enterRouteLocale((await params).locale);
  await requirePlatformAdmin(locale);
  const t = await getTranslations("whatsapp");
  const [templates, overrides, settings] = await Promise.all([
    getTemplates(),
    getOverrides(null),
    getPlatformSettings(),
  ]);
  const setting = (key: string) => settings.find((s) => s.key === key)?.value;
  const unit = setting("messaging.overage_unit_minor");

  return (
    <div className="grid max-w-4xl gap-4">
      <h1 className="text-2xl font-semibold">{t("adminTitle")}</h1>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("termsTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("termsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={savePlatformMessagingSettings}
            className="sm:grid-cols-3 sm:items-end"
            successText={t("saved")}
          >
            <label className="grid gap-1 text-sm">
              {t("allowance")}
              <Input
                name="allowance"
                inputMode="numeric"
                dir="ltr"
                required
                defaultValue={String(setting("messaging.default_allowance") ?? 0)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              {t("overageUnit")}
              <Input
                name="unit"
                inputMode="decimal"
                dir="ltr"
                defaultValue={typeof unit === "number" ? (unit / 100).toFixed(2) : ""}
              />
            </label>
            <div>
              <SubmitButton size="sm">{t("saveSettings")}</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("templatesTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("adminTemplatesDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ul className="divide-y rounded-md border text-sm">
            {templates.map((tpl) => (
              <li key={tpl.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                <span>
                  <span dir="ltr">{tpl.provider_template_name}</span> ·{" "}
                  {tpl.approved ? t("approved") : t("notApproved")}
                </span>
                <ActionForm action={reviewTemplate}>
                  <input type="hidden" name="catalogId" value={tpl.id} />
                  <input type="hidden" name="approved" value={tpl.approved ? "false" : "true"} />
                  <SubmitButton size="sm" variant="outline">
                    {tpl.approved ? t("markNotApproved") : t("markApproved")}
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
          <h3 className="font-medium">{t("pendingOverrides")}</h3>
          {overrides.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
          <ul className="divide-y rounded-md border text-sm">
            {overrides.map((o) => (
              <li key={o.id} className="grid gap-2 p-2">
                <span dir="ltr">{o.provider_template_name}</span>
                <p className="text-muted-foreground">{o.body_preview}</p>
                <span className="flex gap-2">
                  {(["true", "false"] as const).map((v) => (
                    <ActionForm key={v} action={reviewTemplate}>
                      <input type="hidden" name="overrideId" value={o.id} />
                      <input type="hidden" name="approved" value={v} />
                      <SubmitButton size="sm" variant="outline">
                        {v === "true" ? t("markApproved") : t("reject")}
                      </SubmitButton>
                    </ActionForm>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("platformNumberTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("platformNumberDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={configurePlatformNumber} className="sm:grid-cols-2 sm:items-end" successText={t("saved")}>
            <label className="grid gap-1 text-sm">
              {t("clinicId")}
              <Input name="clinicId" required dir="ltr" />
            </label>
            <label className="grid gap-1 text-sm">
              {t("phoneNumberId")}
              <Input name="phoneNumberId" required dir="ltr" pattern="[0-9]{5,30}" />
            </label>
            <label className="grid gap-1 text-sm">
              {t("displayPhone")}
              <Input name="displayPhone" dir="ltr" maxLength={30} />
            </label>
            <label className="grid gap-1 text-sm">
              {t("credentialRef")}
              <Input name="credentialRef" required dir="ltr" pattern="[A-Za-z0-9_]{3,64}" />
            </label>
            <div>
              <SubmitButton size="sm">{t("saveConnection")}</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
