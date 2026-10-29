"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FormError, FormSuccess } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Input } from "@/components/ui/input";
import { saveConsultation } from "@/modules/clinical/actions";
import type { TemplateField } from "@/modules/clinical/types";
import type { ActionState } from "@/modules/shared/form-state";

const control = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export function ConsultationForm({
  consultationId,
  fields,
  values,
}: {
  consultationId: string;
  fields: TemplateField[];
  values: Record<string, unknown>;
}) {
  const t = useTranslations("consultation");
  const locale = useLocale();
  const [state, action] = useActionState<ActionState, FormData>(saveConsultation, { error: null });

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="consultationId" value={consultationId} />
      {fields.map((field) => {
        const name = `field_${field.key}`;
        const value = values[field.key];
        const label = (
          <span>
            {field.label}
            {field.required ? <span className="text-destructive"> *</span> : null}
          </span>
        );
        if (field.type === "checkbox") {
          return (
            <label key={field.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={name} defaultChecked={value === true} className="size-4" />
              {label}
            </label>
          );
        }
        return (
          <label key={field.key} className="grid gap-1 text-sm">
            {label}
            {field.type === "textarea" ? (
              <textarea
                name={name}
                defaultValue={typeof value === "string" ? value : ""}
                rows={4}
                className={control}
              />
            ) : field.type === "select" ? (
              <select name={name} defaultValue={typeof value === "string" ? value : ""} className={control}>
                <option value="">—</option>
                {field.options?.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                name={name}
                type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                step={field.type === "number" ? "any" : undefined}
                defaultValue={value === undefined || value === null ? "" : String(value)}
              />
            )}
          </label>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="intent" value="save" variant="outline">
          {t("saveDraft")}
        </SubmitButton>
        <SubmitButton name="intent" value="complete">
          {t("complete")}
        </SubmitButton>
      </div>
      <p className="text-xs text-muted-foreground">{t("completeHint")}</p>
      <FormError code={state.error} />
      {state.done ? <FormSuccess>{t("saved")}</FormSuccess> : null}
    </form>
  );
}
