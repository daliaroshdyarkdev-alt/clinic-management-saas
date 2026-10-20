import { isLocale } from "@/lib/i18n/config";

/** Route prefixes (after the locale) that require a signed-in user. */
const PROTECTED_PREFIXES = ["c", "workspaces", "admin"] as const;

export function isProtectedPath(pathname: string): boolean {
  const [, locale, section] = pathname.split("/");
  if (!isLocale(locale)) return false;
  return (PROTECTED_PREFIXES as readonly string[]).includes(section ?? "");
}
