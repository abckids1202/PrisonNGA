/**
 * A recording encryption control reference identifies an external storage
 * policy. It is metadata, never key material, and must remain safe to persist
 * in D1 and object metadata.
 */
export function isSafeRecordingEncryptionReference(value: string | null | undefined): boolean {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/.test(value.trim());
}
