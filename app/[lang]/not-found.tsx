import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { lang } from "next/root-params";

import { Button } from "@/components/ui/button";
import { defaultLocale, isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";

export default async function NotFound() {
  const value = await lang();
  const locale = isLocale(value) ? value : defaultLocale;
  const dict = getDictionary(locale);
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <FileQuestion className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold">{dict.common.notFoundTitle}</h1>
      <p className="max-w-md text-muted-foreground">{dict.common.notFoundBody}</p>
      <Button asChild>
        <Link href={`/${locale}`}>{dict.common.backHome}</Link>
      </Button>
    </main>
  );
}
