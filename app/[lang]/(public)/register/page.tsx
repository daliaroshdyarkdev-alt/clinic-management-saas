import { Info } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { formatNumber } from "@/lib/time/cairo";

export async function generateMetadata({ params }: PageProps<"/[lang]/register">): Promise<Metadata> {
  const { lang } = await params;
  return { title: getDictionary(isLocale(lang) ? lang : "ar").register.title };
}

/** ONB-001…004 overview. The registration form itself is built in Milestone 1. */
export default async function RegisterPage({ params }: PageProps<"/[lang]/register">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = getDictionary(lang);
  const r = dict.register;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12 sm:py-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{r.title}</h1>
        <p className="mt-2 text-muted-foreground">{r.subtitle}</p>
      </div>
      <Alert variant="info" data-testid="register-notice">
        <Info aria-hidden />
        <AlertDescription>{r.notice}</AlertDescription>
      </Alert>
      <ol className="flex flex-col gap-4">
        {r.steps.map((step, index) => (
          <li key={step.title}>
            <Card className="gap-2 py-5">
              <CardHeader className="grid-cols-[auto_1fr] items-center gap-x-4">
                <span className="row-span-2 flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {formatNumber(index + 1, lang)}
                </span>
                <CardTitle>{step.title}</CardTitle>
                <CardDescription>{step.body}</CardDescription>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
