import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { enterRouteLocale } from "@/i18n/locale";
import { directionOf, routing } from "@/i18n/routing";
import "../globals.css";

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "meta" });
  return { title: t("title"), description: t("description") };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  // Every page renders per request so Next.js can apply the CSP nonce.
  await connection();
  const locale = enterRouteLocale((await params).locale);

  return (
    <html lang={locale} dir={directionOf(locale)} className={`${plexArabic.variable} h-full antialiased`}>
      <body className="min-h-dvh font-sans">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
