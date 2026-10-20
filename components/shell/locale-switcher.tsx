"use client";

import { Languages } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { switchLocalePath, type Locale } from "@/lib/i18n/config";

function SwitchLink({ target, label }: { target: Locale; label: string }) {
  const pathname = usePathname();
  return <LinkButton href={switchLocalePath(pathname, target)} target={target} label={label} />;
}

function LinkButton({ href, target, label }: { href: string; target: Locale; label: string }) {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link href={href} hrefLang={target} lang={target} data-testid="locale-switcher">
        <Languages aria-hidden />
        {label}
      </Link>
    </Button>
  );
}

/** Switches language while staying on the same page. */
export function LocaleSwitcher({ target, label }: { target: Locale; label: string }) {
  return (
    <Suspense fallback={<LinkButton href={`/${target}`} target={target} label={label} />}>
      <SwitchLink target={target} label={label} />
    </Suspense>
  );
}
