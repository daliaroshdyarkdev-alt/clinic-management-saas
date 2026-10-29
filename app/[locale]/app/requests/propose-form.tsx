"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FormError } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Input } from "@/components/ui/input";
import { proposeAlternative } from "@/modules/booking-requests/actions";
import type { ActionState } from "@/modules/shared/form-state";

export function ProposeForm({
  requestId,
  options,
}: {
  requestId: string;
  options: { value: string; label: string }[];
}) {
  const t = useTranslations("requests");
  const locale = useLocale();
  const [state, action] = useActionState<ActionState, FormData>(proposeAlternative, { error: null });

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="requestId" value={requestId} />
      <label className="grid gap-1">
        {t("chartNumber")}
        <Input name="chartNumber" type="number" min={1} required />
      </label>
      <label className="grid gap-1">
        {t("alternative")}
        <select name="slot" required className="h-9 rounded-md border border-input bg-background px-2">
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div>
        <SubmitButton size="sm" variant="outline">
          {t("propose")}
        </SubmitButton>
      </div>
      <FormError code={state.error} />
      {state.link ? (
        <div role="status" className="grid gap-1 rounded-md bg-accent p-2 text-xs">
          <p>{t("linkCreated")}</p>
          <code dir="ltr" className="select-all break-all">
            {state.link}
          </code>
        </div>
      ) : null}
    </form>
  );
}
