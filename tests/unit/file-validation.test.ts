import { describe, expect, it } from "vitest";
import { LICENSE_MAX_BYTES, validateLicenseFile } from "@/modules/onboarding/file-validation";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("licence file validation", () => {
  it("accepts PDF, PNG and JPEG by content", () => {
    expect(validateLicenseFile(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))).toEqual({
      mime: "application/pdf",
      ext: "pdf",
    });
    expect(validateLicenseFile(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toEqual({
      mime: "image/png",
      ext: "png",
    });
    expect(validateLicenseFile(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({ mime: "image/jpeg", ext: "jpg" });
  });

  it("rejects HTML or scripts even if named .pdf", () => {
    expect(validateLicenseFile(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
  });

  it("rejects empty and oversized files", () => {
    expect(validateLicenseFile(new Uint8Array())).toBeNull();
    const big = new Uint8Array(LICENSE_MAX_BYTES + 1);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(validateLicenseFile(big)).toBeNull();
  });
});
