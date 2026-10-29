"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * Route error boundary. Shows no error details (they may contain data); the
 * digest lets support find the server log line.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errorPage");
  return (
    <main className="mx-auto grid max-w-lg gap-3 p-6" role="alert">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-muted-foreground">{t("body")}</p>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">{t("reference", { digest: error.digest })}</p>
      ) : null}
      <div>
        <Button onClick={reset}>{t("retry")}</Button>
      </div>
    </main>
  );
}
