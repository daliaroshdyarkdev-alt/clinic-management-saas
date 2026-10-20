import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";

/**
 * Validates a post-login `next` path so login cannot be abused as an open
 * redirect. Only same-origin, locale-prefixed app paths are accepted.
 */
export function safeNextPath(candidate: unknown, locale: Locale = defaultLocale): string {
  const fallback = `/${locale}/workspaces`;
  if (typeof candidate !== "string" || candidate.length > 512) return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(candidate)) return fallback;
  const firstSegment = candidate.split(/[/?#]/)[1];
  if (!isLocale(firstSegment)) return fallback;
  return candidate;
}
