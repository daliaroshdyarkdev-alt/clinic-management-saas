/**
 * Post-login redirect target. Only same-site paths inside the authenticated
 * area are accepted, which prevents open redirects through `?next=`.
 * Returns a path without the locale prefix (next-intl adds it).
 */
export function safeNextPath(next: string | undefined, locale: string): string {
  const fallback = "/app";
  if (!next) return fallback;
  const prefix = `/${locale}`;
  const path = next.startsWith(`${prefix}/`) ? next.slice(prefix.length) : next;
  if (!/^\/app(\/[A-Za-z0-9\-_/]*)?$/.test(path)) return fallback;
  if (path.includes("//") || path.includes("..")) return fallback;
  return path;
}
