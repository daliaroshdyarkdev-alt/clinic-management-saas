"use client";

import { useTranslations } from "next-intl";
import type { DomainErrorCode } from "@/modules/shared/db-errors";

export type FormErrorCode = DomainErrorCode | "signup_failed" | "weak_password";

export function FormError({ code }: { code: FormErrorCode | null | undefined }) {
  const t = useTranslations("errors");
  if (!code) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t(code)}
    </p>
  );
}

export function FormSuccess({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="text-sm text-primary">
      {children}
    </p>
  );
}
