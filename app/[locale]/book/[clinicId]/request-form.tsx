"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormError, FormSuccess } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Input } from "@/components/ui/input";
import { submitRequest, type PublicState } from "@/modules/public-booking/actions";

export type SlotGroup = { doctor: string; options: { value: string; label: string }[] };

export function RequestForm({ clinicId, groups }: { clinicId: string; groups: SlotGroup[] }) {
  const t = useTranslations("publicBooking");
  const [state, action] = useActionState<PublicState, FormData>(submitRequest, { error: null });

  if (state.outcome === "submitted") return <FormSuccess>{t("submitted")}</FormSuccess>;

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="clinicId" value={clinicId} />
      <label className="grid gap-1 text-sm">
        {t("time")}
        <select name="slot" required className="h-9 rounded-md border border-input bg-background px-2">
          {groups.map((g) => (
            <optgroup key={g.doctor} label={g.doctor}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        {t("name")}
        <Input name="name" required minLength={2} maxLength={200} autoComplete="name" />
      </label>
      <label className="grid gap-1 text-sm">
        {t("phone")}
        <Input
          name="phone"
          required
          dir="ltr"
          placeholder="+2010XXXXXXXX"
          pattern="\+[1-9][0-9]{6,14}"
          autoComplete="tel"
        />
      </label>
      <p className="text-xs text-muted-foreground">{t("privacy")}</p>
      <FormError code={state.error} />
      <SubmitButton pendingLabel={t("sending")}>{t("submit")}</SubmitButton>
    </form>
  );
}
