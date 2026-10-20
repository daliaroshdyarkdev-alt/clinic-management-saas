import { describe, expect, it } from "vitest";

import { redact, REDACTED } from "./redact";

describe("redact (invariant 7)", () => {
  it("redacts sensitive keys at any depth", () => {
    const result = redact({
      requestId: "req-1",
      clinicId: "c-1",
      patient: { fullName: "Test Patient", phone: "01000000000", nationalId: "123" },
      consultation: { notes: "secret clinical text", diagnosis: "x" },
      payment: { amount_minor: 1000 },
      headers: { authorization: "Bearer abc" },
    }) as Record<string, Record<string, unknown>>;

    expect(result.requestId).toBe("req-1");
    expect(result.clinicId).toBe("c-1");
    expect(result.patient).toEqual({ fullName: REDACTED, phone: REDACTED, nationalId: REDACTED });
    expect(result.consultation).toEqual({ notes: REDACTED, diagnosis: REDACTED });
    expect(result.payment).toEqual({ amount_minor: REDACTED });
    expect(result.headers).toEqual({ authorization: REDACTED });
  });

  it("scrubs emails, phone-like numbers and bearer tokens inside free text", () => {
    const text = redact("user test@example.com called +20 100 000 0000 with Bearer abc.def") as string;
    expect(text).not.toMatch(/example\.com|100 000|abc\.def/);
  });

  it("reduces errors to name and scrubbed message", () => {
    expect(redact(new Error("failed for test@example.com"))).toEqual({
      name: "Error",
      message: `failed for ${REDACTED}`,
    });
  });
});
