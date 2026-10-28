import { z } from "zod";

/**
 * Public (browser-safe) configuration. Only the Supabase URL and the
 * publishable key may ever be exposed; service-role / secret keys must never
 * use the NEXT_PUBLIC_ prefix.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function publicEnv(): PublicEnv {
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!parsed.success) {
    throw new Error(
      "Missing or invalid Supabase public configuration. Copy .env.example to .env.local and fill it from `supabase status`.",
    );
  }
  return parsed.data;
}
