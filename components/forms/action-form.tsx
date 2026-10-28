"use client";

import { useActionState, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { FormError, FormSuccess, type FormErrorCode } from "./form-message";

type State = { error: FormErrorCode | null; done?: boolean };

/**
 * Small wrapper for server-action forms: posts the current locale, shows the
 * translated error or an optional success line. Works without JavaScript
 * (progressive enhancement through the form action).
 */
export function ActionForm<S extends State>({
  action,
  children,
  className,
  successText,
}: {
  action: (state: S, formData: FormData) => Promise<S>;
  children: ReactNode;
  className?: string;
  successText?: string;
}) {
  const locale = useLocale();
  const [state, formAction] = useActionState<S, FormData>(action, { error: null } as Awaited<S>);
  return (
    <form action={formAction} className={cn("grid gap-2", className)}>
      <input type="hidden" name="locale" value={locale} />
      {children}
      <FormError code={state.error} />
      {state.done && successText ? <FormSuccess>{successText}</FormSuccess> : null}
    </form>
  );
}
