import { Building2, ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Brand } from "@/components/shell/brand";
import { UserMenu } from "@/components/shell/user-menu";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { directionOf, isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { switchableClinics } from "@/modules/tenancy/active-clinic";
import { getTenancyRepository } from "@/modules/tenancy/repository";

export const metadata: Metadata = { title: "Workspaces" };

/** Post-login workspace picker (STA-004). Lists only the signed-in user's active memberships. */
export default async function WorkspacesPage({ params }: PageProps<"/[lang]/workspaces">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = getDictionary(lang);
  const user = await requireUser(lang, `/${lang}/workspaces`);
  const clinics = switchableClinics(await getTenancyRepository().listMemberships(user.id));
  const Chevron = directionOf(lang) === "rtl" ? ChevronLeft : ChevronRight;

  return (
    <div className="min-h-dvh">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Brand name={dict.common.appName} href={`/${lang}`} />
          <UserMenu
            displayName={user.email ?? user.id.slice(0, 8)}
            signedInAsLabel={dict.shell.signedInAs}
            signOutLabel={dict.common.signOut}
            locale={lang}
            canSignOut
          />
        </div>
      </header>
      <main id="main" className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{dict.workspaces.title}</h1>
          <p className="text-muted-foreground">{dict.workspaces.subtitle}</p>
        </div>
        {clinics.length === 0 ? (
          <Card data-testid="workspaces-empty">
            <CardHeader>
              <CardTitle>{dict.workspaces.emptyTitle}</CardTitle>
              <CardDescription>{dict.workspaces.emptyBody}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {clinics.map((clinic) => (
              <li key={clinic.clinicId}>
                <Link href={`/${lang}/c/${clinic.clinicId}`}>
                  <Card className="py-4 transition-colors hover:bg-accent/40">
                    <CardContent className="flex items-center gap-3">
                      <Building2 className="size-5 text-muted-foreground" aria-hidden />
                      <span className="flex-1 font-medium">{clinic.clinicName}</span>
                      <Badge variant="outline">{dict.clinicStates[clinic.clinicState]}</Badge>
                      <Chevron className="size-4 text-muted-foreground" aria-hidden />
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
