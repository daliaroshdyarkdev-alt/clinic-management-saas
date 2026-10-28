import "server-only";
import { z } from "zod";

/**
 * Canonical origin used to build links that leave the app (invitation links,
 * email redirects). Never derived from request headers, which a client controls.
 */
export function siteUrl(): string {
  const parsed = z.url().safeParse(process.env.SITE_URL);
  if (parsed.success) return parsed.data.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error("SITE_URL must be configured in production");
  }
  return "http://localhost:3000";
}
