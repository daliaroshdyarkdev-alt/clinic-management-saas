import { describe, expect, it } from "vitest";

import { readPublicEnv } from "./public";
import { serverEnvSchema } from "./server-schema";

describe("server env (ADR-0005)", () => {
  it("defaults to development without preview", () => {
    expect(serverEnvSchema.parse({})).toEqual({ APP_ENV: "development", UI_PREVIEW_ENABLED: false });
  });

  it("refuses the UI preview in production", () => {
    expect(() => serverEnvSchema.parse({ APP_ENV: "production", UI_PREVIEW_ENABLED: "true" })).toThrow();
  });

  it("allows the preview outside production", () => {
    expect(serverEnvSchema.parse({ APP_ENV: "staging", UI_PREVIEW_ENABLED: "true" }).UI_PREVIEW_ENABLED).toBe(true);
  });
});

describe("public env", () => {
  it("rejects a malformed Supabase URL", () => {
    expect(() => readPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url" })).toThrow();
  });

  it("treats empty strings as unset", () => {
    expect(readPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" })).toEqual({});
  });
});
