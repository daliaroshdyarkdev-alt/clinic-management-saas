import { notFound } from "next/navigation";

import { PublicFooter } from "@/components/shell/public-footer";
import { PublicHeader } from "@/components/shell/public-header";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";

export default async function PublicLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = getDictionary(lang);
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader locale={lang} dict={dict} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <PublicFooter dict={dict} />
    </div>
  );
}
