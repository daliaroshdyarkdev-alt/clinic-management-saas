import { describe, expect, it } from "vitest";

import { maskIdentifier, maskName, maskPhone } from "./mask";

describe("PII masking (PAT-005)", () => {
  it("masks phone numbers leaving prefix and last two digits", () => {
    expect(maskPhone("+20 100 000 0012")).toBe("201•••••••12");
  });

  it("masks identifiers leaving the last four characters", () => {
    expect(maskIdentifier("12345678901234")).toBe("••••••••••1234");
    expect(maskIdentifier("123")).toBe("•••");
  });

  it("keeps first name and initials", () => {
    expect(maskName("Test Patient Sample")).toBe("Test P. S.");
  });
});
