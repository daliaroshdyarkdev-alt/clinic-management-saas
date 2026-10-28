/**
 * Post-login redirect target. Only same-site paths inside the authenticated
 * area, the platform admin area or an invitation link are accepted, which
 * prevents open redirects through `?next=`. Returns a path without the locale
 * prefix (callers add it).
 */
const ALLOWED = [/^\/app(\/[A-Za-z0-9\-_/]*)?$/, /^\/admin(\/[A-Za-z0-9\-_/]*)?$/, /^\/invite\/[A-Za-z0-9_-]{20,100}$/];

export function safeNextPath(next: string | undefined, locale: string): string {
  const fallback = "/app";
  if (!next) return fallback;
  const prefix = `/${locale}`;
  const path = next.startsWith(`${prefix}/`) ? next.slice(prefix.length) : next;
  if (path.includes("//") || path.includes("..")) return fallback;
  return ALLOWED.some((re) => re.test(path)) ? path : fallback;
}
