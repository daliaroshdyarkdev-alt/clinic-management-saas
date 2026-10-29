/**
 * EGP amounts are handled as integer piasters (minor units) end to end;
 * floats are never used for money. Input accepts "150", "150.5", "150.50"
 * (Western or Arabic-Indic digits, "." or "٫" as decimal separator).
 */
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function parseEgpToMinor(input: string): number | null {
  const normalized = input
    .trim()
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace("٫", ".")
    .replace(/[,\s]/g, "");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const pounds = Number(match[1]);
  const piasters = Number((match[2] ?? "").padEnd(2, "0"));
  return pounds * 100 + piasters;
}

export function formatEgp(minor: number, locale: "ar" | "en"): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", {
    style: "currency",
    currency: "EGP",
    minimumFractionDigits: 2,
  }).format(minor / 100);
}
