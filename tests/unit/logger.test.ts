import { afterEach, describe, expect, it, vi } from "vitest";
import { logger, redact } from "@/lib/telemetry/logger";

describe("telemetry redaction", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps allow-listed operational fields", () => {
    expect(redact({ event: "x", status: 200, durationMs: 12, clinicId: "c1" })).toEqual({
      event: "x",
      status: 200,
      durationMs: 12,
      clinicId: "c1",
    });
  });

  it("redacts personal, clinical and financial fields", () => {
    const out = redact({
      patientName: "Synthetic Patient",
      phone: "+201000000000",
      diagnosis: "synthetic",
      amountMinor: 15000,
      email: "x@example.test",
    });
    expect(Object.values(out)).toEqual(Array(5).fill("[redacted]"));
  });

  it("redacts nested objects even under allowed keys", () => {
    expect(redact({ event: { patient: "x" } })).toEqual({ event: "[redacted]" });
  });

  it("never writes a disallowed value to the console", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logger.info({ event: "test", nationalId: "29001010101010" });
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0][0])).not.toContain("29001010101010");
  });
});
