"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FormError, FormSuccess } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveTemplate } from "@/modules/clinical/actions";
import type { TemplateField } from "@/modules/clinical/types";
import type { ActionState } from "@/modules/shared/form-state";

const TYPES = ["text", "textarea", "number", "date", "select", "checkbox"] as const;

function keyFrom(label: string, index: number) {
  const ascii = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(ascii) ? ascii.slice(0, 40) : `field_${index + 1}`;
}

export function TemplateEditor({ clinicDoctorId, initial }: { clinicDoctorId: string; initial: TemplateField[] }) {
  const t = useTranslations("template");
  const locale = useLocale();
  const [fields, setFields] = useState<(TemplateField & { optionsText?: string })[]>(
    initial.map((f) => ({ ...f, optionsText: f.options?.join(", ") })),
  );
  const [state, action] = useActionState<ActionState, FormData>(saveTemplate, { error: null });
  const update = (i: number, patch: Partial<TemplateField & { optionsText?: string }>) =>
    setFields((all) => all.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const payload = fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required ?? false,
    ...(f.type === "select"
      ? {
          options: (f.optionsText ?? "")
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean),
        }
      : {}),
  }));

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="clinicDoctorId" value={clinicDoctorId} />
      <input type="hidden" name="fields" value={JSON.stringify(payload)} />
      {fields.map((f, i) => (
        <div key={i} className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-[2fr_1fr_auto_auto] sm:items-end">
          <label className="grid gap-1">
            {t("label")}
            <Input value={f.label} required maxLength={120} onChange={(e) => update(i, { label: e.target.value })} />
          </label>
          <label className="grid gap-1">
            {t("type")}
            <select
              value={f.type}
              onChange={(e) => update(i, { type: e.target.value as TemplateField["type"] })}
              className="h-9 rounded-md border border-input bg-background px-2"
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={f.required ?? false}
              onChange={(e) => update(i, { required: e.target.checked })}
            />
            {t("required")}
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setFields((all) => all.filter((_, j) => j !== i))}
          >
            {t("remove")}
          </Button>
          {f.type === "select" ? (
            <label className="grid gap-1 sm:col-span-4">
              {t("options")}
              <Input value={f.optionsText ?? ""} onChange={(e) => update(i, { optionsText: e.target.value })} />
            </label>
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setFields((all) => {
              const used = new Set(all.map((f) => f.key));
              let key = keyFrom("", all.length);
              while (used.has(key)) key = `${key}_x`;
              return [...all, { key, label: "", type: "textarea" }];
            })
          }
        >
          {t("addField")}
        </Button>
        <SubmitButton size="sm">{t("save")}</SubmitButton>
      </div>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      <FormError code={state.error} />
      {state.done ? <FormSuccess>{t("saved")}</FormSuccess> : null}
    </form>
  );
}
