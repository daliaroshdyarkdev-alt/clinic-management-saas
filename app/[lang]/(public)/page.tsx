import {
  CalendarDays,
  CheckCircle2,
  CreditCard,
  MessageCircle,
  ShieldCheck,
  Stethoscope,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";

const featureIcons = [CalendarDays, Stethoscope, Wallet, MessageCircle, Users, CreditCard];

export default async function LandingPage({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = getDictionary(lang);
  const l = dict.landing;

  return (
    <>
      <section className="border-b bg-gradient-to-b from-accent/60 to-background">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:py-24">
          <div className="space-y-6">
            <p className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
              <ShieldCheck className="size-3.5 text-primary" aria-hidden />
              {l.eyebrow}
            </p>
            <h1 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl lg:text-5xl">
              {l.title}
            </h1>
            <p className="max-w-2xl text-lg text-pretty text-muted-foreground">{l.subtitle}</p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href={`/${lang}/register`}>{l.ctaRegister}</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href={`/${lang}/login`}>{l.ctaLogin}</Link>
              </Button>
              <Button size="lg" variant="ghost" asChild>
                <Link href={`/${lang}/preview`}>{l.ctaPreview}</Link>
              </Button>
            </div>
          </div>
          <Card className="border-primary/20 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-primary" aria-hidden />
                {l.securityTitle}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {l.security.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="mb-8 text-2xl font-semibold tracking-tight">{l.featuresTitle}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {l.features.map((feature, index) => {
            const Icon = featureIcons[index] ?? ShieldCheck;
            return (
              <Card key={feature.title} className="gap-3">
                <CardHeader>
                  <span className="mb-2 flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <CardTitle>{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{feature.body}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </>
  );
}
