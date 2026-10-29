"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FormError } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Input } from "@/components/ui/input";
import { recordPayment } from "@/modules/finance/actions";
import type { ActionState } from "@/modules/shared/form-state";

export function PaymentForm({ accounts }: { accounts: { id: string; name: string }[] }) {
  const t = useTranslations("finance");
  const locale = useLocale();
  const [state, action] = useActionState<ActionState, FormData>(recordPayment, { error: null });
  const select = "h-9 rounded-md border border-input bg-background px-2";

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-3 sm:items-end">
      <input type="hidden" name="locale" value={locale} />
      <label className="grid gap-1 text-sm">
        {t("amount")}
        <Input name="amount" inputMode="decimal" dir="ltr" required placeholder="0.00" />
      </label>
      <label className="grid gap-1 text-sm">
        {t("method")}
        <select name="method" className={select}>
          {(["cash", "pos", "instapay", "bank_transfer"] as const).map((m) => (
            <option key={m} value={m}>
              {t(`methods.${m}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        {t("account")}
        <select name="accountId" className={select}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        {t("reference")}
        <Input name="reference" maxLength={200} />
      </label>
      <label className="grid gap-1 text-sm">
        {t("chartNumber")}
        <Input name="chartNumber" type="number" min={1} />
      </label>
      <div>
        <SubmitButton>{t("recordPayment")}</SubmitButton>
      </div>
      <div className="sm:col-span-3">
        <FormError code={state.error} />
        {state.link ? (
          <a href={state.link} target="_blank" rel="noopener" className="text-sm text-primary underline">
            {t("printReceipt")}
          </a>
        ) : null}
      </div>
    </form>
  );
}
