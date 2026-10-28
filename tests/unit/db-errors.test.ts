import { describe, expect, it } from "vitest";
import { toDomainError } from "@/modules/shared/db-errors";

describe("toDomainError", () => {
  it("maps insufficient_privilege to forbidden", () => {
    expect(toDomainError({ code: "42501", message: "permission denied for table clinics" })).toBe("forbidden");
  });

  it("passes through known rule codes", () => {
    expect(toDomainError({ code: "P0001", message: "invitation_expired" })).toBe("invitation_expired");
  });

  it("hides unknown database messages", () => {
    expect(toDomainError({ code: "23505", message: 'duplicate key value violates unique constraint "x"' })).toBe(
      "unexpected",
    );
    expect(toDomainError(null)).toBe("unexpected");
  });
});
