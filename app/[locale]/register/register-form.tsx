"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FormError, FormSuccess } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp, type FormState } from "@/modules/onboarding/actions";

export function RegisterForm({ next }: { next?: string }) {
  const t = useTranslations("register");
  const locale = useLocale();
  const [state, action] = useActionState<FormState, FormData>(signUp, { error: null });

  if (state.notice === "confirm_email") return <FormSuccess>{t("confirmEmail")}</FormSuccess>;

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="locale" value={locale} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="grid gap-2">
        <Label htmlFor="fullName">{t("fullName")}</Label>
        <Input id="fullName" name="fullName" autoComplete="name" required minLength={2} maxLength={200} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" dir="ltr" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          required
          minLength={10}
        />
        <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
      </div>
      <FormError code={state.error} />
      <SubmitButton pendingLabel={t("submitting")}>{t("submit")}</SubmitButton>
    </form>
  );
}
