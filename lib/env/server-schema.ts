import { z } from "zod";

const booleanFlag = z
  .enum(["true", "false", ""])
  .optional()
  .transform((value) => value === "true");

export const serverEnvSchema = z
  .object({
    APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    /** ADR-0005: synthetic UI preview routes. Refused in production. */
    UI_PREVIEW_ENABLED: booleanFlag,
  })
  .refine((env) => !(env.APP_ENV === "production" && env.UI_PREVIEW_ENABLED), {
    message: "UI_PREVIEW_ENABLED must not be true when APP_ENV=production",
    path: ["UI_PREVIEW_ENABLED"],
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;
