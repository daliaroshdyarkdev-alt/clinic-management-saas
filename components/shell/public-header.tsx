import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries";

import { Brand } from "./brand";
import { LocaleSwitcher } from "./locale-switcher";

export function PublicHeader({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const other: Locale = locale === "ar" ? "en" : "ar";
  return (
    <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Brand name={dict.common.appName} href={`/${locale}`} />
        <div className="flex items-center gap-1 sm:gap-2">
          <LocaleSwitcher target={other} label={dict.common.otherLanguage} />
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link href={`/${locale}/login`}>{dict.common.signIn}</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href={`/${locale}/register`}>{dict.common.register}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
