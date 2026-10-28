"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FormError } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerClinic, type FormState } from "@/modules/onboarding/actions";

export function ClinicForm({
  disclaimerVersionId,
  disclaimerText,
  isDraft,
}: {
  disclaimerVersionId: string;
  disclaimerText: string;
  isDraft: boolean;
}) {
  const t = useTranslations("newClinic");
  const locale = useLocale();
  const [state, action] = useActionState<FormState, FormData>(registerClinic, { error: null });

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="disclaimerVersionId" value={disclaimerVersionId} />
      <div className="grid gap-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" name="name" required minLength={2} maxLength={200} />
      </div>
      <fieldset className="grid gap-3 rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">{t("disclaimerTitle")}</legend>
        {isDraft ? <p className="text-xs font-medium text-destructive">{t("disclaimerDraft")}</p> : null}
        <p className="text-sm leading-relaxed text-muted-foreground">{disclaimerText}</p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="acceptDisclaimer" required className="mt-1 size-4" />
          <span>{t("acceptDisclaimer")}</span>
        </label>
      </fieldset>
      <FormError code={state.error} />
      <SubmitButton pendingLabel={t("submitting")}>{t("submit")}</SubmitButton>
    </form>
  );
}
