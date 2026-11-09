export async function getD1(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable. Configure the DB binding before using the backend.");
  return env.DB;
}

export async function getEvidenceBucket(): Promise<R2Bucket | null> {
  try {
    const { env } = await import("cloudflare:workers");
    return ((env as unknown as { EVIDENCE_BUCKET?: R2Bucket }).EVIDENCE_BUCKET) || null;
  } catch {
    return null;
  }
}

export async function getRecordingBucket(): Promise<R2Bucket | null> {
  try {
    const { env } = await import("cloudflare:workers");
    return ((env as unknown as { RECORDINGS_BUCKET?: R2Bucket }).RECORDINGS_BUCKET) || null;
  } catch {
    return null;
  }
}

/**
 * Returns the bound notification queue, not merely its configured name.
 * Environment variables can survive a broken deployment manifest, so
 * readiness must verify the actual Cloudflare binding before declaring the
 * queue dependency available.
 */
export async function getNotificationQueue(): Promise<{ send(message: unknown): Promise<void> } | null> {
  try {
    const { env } = await import("cloudflare:workers");
    const queue = (env as unknown as { NOTIFICATION_QUEUE?: { send(message: unknown): Promise<void> } }).NOTIFICATION_QUEUE;
    return queue || null;
  } catch {
    return null;
  }
}
