import { describe, expect, it } from "vitest";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import { DOMAIN_ERROR_CODES } from "@/modules/shared/db-errors";
import { POLICY_OPTIONS } from "@/modules/scheduling/policy-options";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("translations", () => {
  it("Arabic and English define exactly the same keys", () => {
    expect(new Set(keys(ar))).toEqual(new Set(keys(en)));
  });

  it("every database error code has a message", () => {
    for (const code of [...DOMAIN_ERROR_CODES, "invalid_input", "unexpected"]) {
      expect(en.errors, code).toHaveProperty(code);
    }
  });

  it("every scheduling policy option and weekday has a label (dynamic keys)", () => {
    for (const [field, values] of Object.entries(POLICY_OPTIONS)) {
      for (const value of values) expect(keys(en.policy)).toContain(`${field}.${value}`);
      expect(keys(en.policy)).toContain(`${field}.label`);
    }
    for (let d = 0; d < 7; d++) expect(en.weekdays).toHaveProperty(String(d));
  });
});
