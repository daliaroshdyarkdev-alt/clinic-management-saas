export const LICENSE_MAX_BYTES = 10 * 1024 * 1024;

export type LicenseFileKind =
  { mime: "application/pdf"; ext: "pdf" } | { mime: "image/jpeg"; ext: "jpg" } | { mime: "image/png"; ext: "png" };

const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  bytes.length >= signature.length && signature.every((b, i) => bytes[i] === b);

/**
 * Identifies a licence file by its content (magic bytes), never by the file
 * name or the browser-supplied MIME type.
 */
export function sniffLicenseFile(bytes: Uint8Array): LicenseFileKind | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", ext: "pdf" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  return null;
}

export function validateLicenseFile(bytes: Uint8Array): LicenseFileKind | null {
  if (bytes.length === 0 || bytes.length > LICENSE_MAX_BYTES) return null;
  return sniffLicenseFile(bytes);
}
