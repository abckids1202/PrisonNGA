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
