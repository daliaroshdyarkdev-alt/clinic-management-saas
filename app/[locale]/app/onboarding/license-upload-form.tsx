"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FormError, FormSuccess } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadLicense, type FormState } from "@/modules/onboarding/actions";

export function LicenseUploadForm({ licenseType }: { licenseType: "clinic_operating" | "doctor_professional" }) {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const [state, action] = useActionState<FormState, FormData>(uploadLicense, { error: null });
  const inputId = `file-${licenseType}`;

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="licenseType" value={licenseType} />
      <Label htmlFor={inputId}>{t("chooseFile")}</Label>
      <Input
        id={inputId}
        name="file"
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        required
      />
      <p className="text-xs text-muted-foreground">{t("fileHint")}</p>
      <FormError code={state.error} />
      {state.notice === "uploaded" ? <FormSuccess>{t("uploaded")}</FormSuccess> : null}
      <div>
        <SubmitButton size="sm" pendingLabel={t("uploading")}>
          {t("upload")}
        </SubmitButton>
      </div>
    </form>
  );
}
