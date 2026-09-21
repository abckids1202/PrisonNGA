import { getSecuritySalt, hashIdentifier, SecurityError } from "./security";

export async function enforceRateLimit(d1: D1Database, input: { key: string; limit: number; windowSeconds: number }) {
  const keyHash = await hashIdentifier(`rate-limit:${input.key}`, await getSecuritySalt());
  const nowSeconds = Math.floor(Date.now() / 1000);
  const now = new Date().toISOString();
  await d1.prepare("INSERT OR IGNORE INTO rate_limit_buckets (key_hash, window_started_at, request_count, updated_at) VALUES (?, ?, 0, ?)").bind(keyHash, nowSeconds, now).run();
  const incremented = await d1.prepare("UPDATE rate_limit_buckets SET request_count = request_count + 1, updated_at = ? WHERE key_hash = ? AND window_started_at > ? AND request_count < ?").bind(now, keyHash, nowSeconds - input.windowSeconds, input.limit).run();
  if (incremented.meta.changes) return;
  const bucket = await d1.prepare("SELECT window_started_at, request_count FROM rate_limit_buckets WHERE key_hash = ?").bind(keyHash).first<{ window_started_at: number; request_count: number }>();
  if (!bucket || bucket.window_started_at <= nowSeconds - input.windowSeconds) {
    const reset = await d1.prepare("UPDATE rate_limit_buckets SET window_started_at = ?, request_count = 1, updated_at = ? WHERE key_hash = ? AND window_started_at <= ?").bind(nowSeconds, now, keyHash, nowSeconds - input.windowSeconds).run();
    if (reset.meta.changes) return;
  }
  throw new SecurityError("RATE_LIMITED", 429);
}
