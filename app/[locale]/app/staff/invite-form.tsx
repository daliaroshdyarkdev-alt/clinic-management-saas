"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FormError } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inviteStaff, type StaffFormState } from "@/modules/staff/actions";

export function InviteForm({ roles }: { roles: readonly ("manager" | "receptionist" | "cashier" | "doctor")[] }) {
  const t = useTranslations("staff");
  const tr = useTranslations("shell.roles");
  const locale = useLocale();
  const [state, action] = useActionState<StaffFormState, FormData>(inviteStaff, { error: null });

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
      <input type="hidden" name="locale" value={locale} />
      <div className="grid gap-2">
        <Label htmlFor="invite-email">{t("inviteEmail")}</Label>
        <Input id="invite-email" name="email" type="email" dir="ltr" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="invite-role">{t("role")}</Label>
        <select
          id="invite-role"
          name="role"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          required
        >
          {roles.map((role) => (
            <option key={role} value={role}>
              {tr(role)}
            </option>
          ))}
        </select>
      </div>
      <SubmitButton pendingLabel={t("inviting")}>{t("invite")}</SubmitButton>
      <div className="sm:col-span-3">
        <FormError code={state.error} />
        {state.inviteLink ? (
          <div role="status" className="grid gap-1 rounded-md bg-accent p-3 text-sm">
            <p>{t("inviteCreated")}</p>
            <code dir="ltr" className="break-all select-all text-xs">
              {state.inviteLink}
            </code>
          </div>
        ) : null}
      </div>
    </form>
  );
}
