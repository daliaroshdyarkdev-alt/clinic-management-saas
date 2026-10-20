import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { notFound } from "next/navigation";

import { DirectionProvider } from "@/components/shell/direction-provider";
import { directionOf, isLocale, locales } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";

import "../globals.css";

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  const dict = getDictionary(isLocale(lang) ? lang : "ar");
  return {
    title: { default: dict.common.appName, template: `%s · ${dict.common.appName}` },
    description: dict.common.tagline,
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fbfb" },
    { media: "(prefers-color-scheme: dark)", color: "#151c22" },
  ],
};

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dir = directionOf(lang);
  const dict = getDictionary(lang);

  return (
    <html lang={lang} dir={dir} className={plexArabic.variable}>
      <body className="min-h-dvh font-sans">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
        >
          {dict.common.skipToContent}
        </a>
        <DirectionProvider dir={dir}>{children}</DirectionProvider>
      </body>
    </html>
  );
}
