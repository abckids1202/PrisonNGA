/**
 * Rate-limit keys are intentionally hashed, so inactive keys cannot be
 * discovered or reclaimed by request handling. Keep the table bounded from
 * the scheduled worker instead of making every request pay cleanup cost.
 */
export async function purgeStaleRateLimitBuckets(db: Pick<D1Database, "prepare">): Promise<void> {
  await db.prepare(`DELETE FROM rate_limit_buckets
    WHERE key_hash IN (
      SELECT key_hash FROM rate_limit_buckets
      WHERE julianday(updated_at) <= julianday('now', '-2 days')
      LIMIT 1000
    )`).run();
}
