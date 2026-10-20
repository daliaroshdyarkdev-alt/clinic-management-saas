import type { Locale } from "@/lib/i18n/config";

/**
 * Money is an integer number of piasters (EGP minor units; 100 piasters =
 * 1 EGP). Floats are never used for amounts (FIN-015).
 */
export type Piasters = number & { readonly __brand: "Piasters" };

export function piasters(value: number): Piasters {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Money amounts must be safe integers in piasters, got ${value}`);
  }
  return value as Piasters;
}

export function addPiasters(...amounts: Piasters[]): Piasters {
  return piasters(amounts.reduce((sum, amount) => sum + amount, 0));
}

const intlLocale: Record<Locale, string> = { ar: "ar-EG-u-nu-arab", en: "en-EG" };

export function formatEgp(amount: Piasters, locale: Locale): string {
  // Intl formats the rounded major-unit value; piasters / 100 is exact for display.
  return new Intl.NumberFormat(intlLocale[locale], {
    style: "currency",
    currency: "EGP",
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}
