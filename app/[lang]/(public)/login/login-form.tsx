"use client";

import { AlertCircle } from "lucide-react";
import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type SignInState } from "@/lib/auth/actions";
import type { Locale } from "@/lib/i18n/config";

type Labels = {
  email: string;
  password: string;
  submit: string;
  errors: Record<NonNullable<SignInState>["error"], string>;
};

export function LoginForm({
  locale,
  next,
  initialError,
  labels,
}: {
  locale: Locale;
  next: string;
  initialError: SignInState;
  labels: Labels;
}) {
  const [state, action, pending] = useActionState(signIn, initialError);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />
      {state ? (
        <Alert variant={state.error === "auth_unavailable" ? "warning" : "destructive"} data-testid="login-error">
          <AlertCircle aria-hidden />
          <AlertDescription>{labels.errors[state.error]}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{labels.email}</Label>
        <Input
          key={state?.email ?? ""}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          dir="ltr"
          defaultValue={state?.email}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{labels.password}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" dir="ltr" required />
      </div>
      <Button type="submit" disabled={pending} className="mt-2">
        {labels.submit}
      </Button>
    </form>
  );
}
