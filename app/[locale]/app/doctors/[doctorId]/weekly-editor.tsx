"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FormError, FormSuccess } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveWeeklySchedule } from "@/modules/scheduling/actions";
import type { ActionState } from "@/modules/shared/form-state";

type Row = { weekday: number; start: string; end: string; capacity: number | null };

export function WeeklyEditor({
  clinicDoctorId,
  initial,
  needsCapacity,
}: {
  clinicDoctorId: string;
  initial: Row[];
  needsCapacity: boolean;
}) {
  const t = useTranslations("doctors");
  const tw = useTranslations("weekdays");
  const locale = useLocale();
  const [rows, setRows] = useState<Row[]>(initial);
  const [state, action] = useActionState<ActionState, FormData>(saveWeeklySchedule, { error: null });

  const update = (index: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="clinicDoctorId" value={clinicDoctorId} />
      <input type="hidden" name="slots" value={JSON.stringify(rows)} />
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("noWeekly")}</p> : null}
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 text-sm">
          <label className="grid gap-1">
            {t("weekday")}
            <select
              value={row.weekday}
              onChange={(e) => update(i, { weekday: Number(e.target.value) })}
              className="h-9 rounded-md border border-input bg-background px-2"
            >
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {tw(String(d) as "0" | "1" | "2" | "3" | "4" | "5" | "6")}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            {t("from")}
            <Input
              type="time"
              value={row.start}
              onChange={(e) => update(i, { start: e.target.value })}
              required
              className="w-32"
            />
          </label>
          <label className="grid gap-1">
            {t("to")}
            <Input
              type="time"
              value={row.end}
              onChange={(e) => update(i, { end: e.target.value })}
              required
              className="w-32"
            />
          </label>
          {needsCapacity ? (
            <label className="grid gap-1">
              {t("capacity")}
              <Input
                type="number"
                min={1}
                max={500}
                required
                value={row.capacity ?? ""}
                onChange={(e) => update(i, { capacity: e.target.value ? Number(e.target.value) : null })}
                className="w-24"
              />
            </label>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
            {t("remove")}
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setRows((r) => [...r, { weekday: 6, start: "17:00", end: "21:00", capacity: needsCapacity ? 20 : null }])
          }
        >
          {t("addBlock")}
        </Button>
        <SubmitButton size="sm">{t("saveSchedule")}</SubmitButton>
      </div>
      <FormError code={state.error} />
      {state.done ? <FormSuccess>{t("saved")}</FormSuccess> : null}
    </form>
  );
}
