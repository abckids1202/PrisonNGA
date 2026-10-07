export async function purgeExpiredAuthArtifacts(db: Pick<D1Database, "prepare" | "batch">): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM auth_challenge_delivery_attempts WHERE challenge_id IN (SELECT id FROM auth_challenges WHERE julianday(expires_at) <= julianday('now') OR (consumed_at IS NOT NULL AND julianday(consumed_at) <= julianday('now', '-1 day')) )"),
    db.prepare("DELETE FROM auth_challenges WHERE julianday(expires_at) <= julianday('now') OR (consumed_at IS NOT NULL AND julianday(consumed_at) <= julianday('now', '-1 day'))"),
    db.prepare("DELETE FROM auth_federation_states WHERE julianday(expires_at) <= julianday('now') OR (consumed_at IS NOT NULL AND julianday(consumed_at) <= julianday('now', '-1 day'))"),
    db.prepare("DELETE FROM saml_request_cache WHERE julianday(created_at) <= julianday('now', '-1 day')"),
  ]);
}

/**
 * A delivery request can outlive the Worker invocation that started it. Do
 * not leave an ambiguous challenge active forever: expire both the stale
 * attempt and its challenge so the visitor can request a fresh code.
 */
export async function reconcileStaleAuthDeliveryAttempts(db: Pick<D1Database, "prepare" | "batch">): Promise<void> {
  await db.batch([
    db.prepare(`UPDATE auth_challenge_delivery_attempts
      SET status = 'FAILED', error_code = 'AUTH_DELIVERY_ATTEMPT_STALE', completed_at = CURRENT_TIMESTAMP
      WHERE status = 'PENDING' AND julianday(started_at) <= julianday('now', '-5 minutes')`),
    db.prepare(`UPDATE auth_challenges
      SET expires_at = CURRENT_TIMESTAMP
      WHERE consumed_at IS NULL AND julianday(expires_at) > julianday('now')
        AND id IN (
          SELECT challenge_id FROM auth_challenge_delivery_attempts
          WHERE status = 'FAILED' AND error_code = 'AUTH_DELIVERY_ATTEMPT_STALE'
        )`),
  ]);
}

/** Keep revoked session history available for a bounded period, but do not
 * retain expired authentication tokens indefinitely. Token hashes are not
 * useful after expiry and the session table is operational security data. */
export async function purgeExpiredAuthSessions(db: Pick<D1Database, "prepare">): Promise<void> {
  await db.prepare("DELETE FROM auth_sessions WHERE julianday(expires_at) <= julianday('now') OR (revoked_at IS NOT NULL AND julianday(revoked_at) <= julianday('now', '-30 days'))").run();
}
