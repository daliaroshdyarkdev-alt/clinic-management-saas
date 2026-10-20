import { Building2, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/shell/brand";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { PreviewBanner } from "@/components/shell/preview-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { demoClinics, demoRoles } from "@/lib/demo/fixtures";
import { getDictionary } from "@/lib/i18n/dictionaries";

import { assertPreview, previewClinicPath } from "./frames";

export const metadata: Metadata = { title: "Preview" };

export default async function PreviewIndexPage({ params }: PageProps<"/[lang]/preview">) {
  const lang = assertPreview((await params).lang);
  const dict = getDictionary(lang);
  const p = dict.preview;

  return (
    <div className="min-h-dvh">
      <PreviewBanner text={p.banner} />
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Brand name={dict.common.appName} href={`/${lang}`} />
          <LocaleSwitcher target={lang === "ar" ? "en" : "ar"} label={dict.common.otherLanguage} />
        </div>
      </header>
      <main id="main" className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{p.title}</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">{p.subtitle}</p>
        </div>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{p.clinics}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {demoClinics.map((clinic) => (
              <Card key={clinic.id} className="gap-4" data-testid="preview-clinic">
                <CardHeader>
                  <CardTitle className="flex items-start gap-2">
                    <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    {clinic.name[lang]}
                  </CardTitle>
                  <Badge variant={clinic.state === "active" ? "success" : "warning"}>
                    {dict.clinicStates[clinic.state]}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{p.openAs}</p>
                  <div className="flex flex-wrap gap-2">
                    {demoRoles.map((role) => (
                      <Button key={role} variant="outline" size="sm" asChild>
                        <Link href={previewClinicPath(lang, clinic.id, role)}>{dict.roles[role]}</Link>
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <div>
          <Button asChild variant="secondary">
            <Link href={`/${lang}/preview/admin`}>
              <ShieldCheck aria-hidden />
              {p.adminPreview}
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
