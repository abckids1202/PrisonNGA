export async function purgeExpiredAuthArtifacts(db: Pick<D1Database, "prepare" | "batch">): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM auth_challenge_delivery_attempts WHERE challenge_id IN (SELECT id FROM auth_challenges WHERE julianday(expires_at) <= julianday('now') OR (consumed_at IS NOT NULL AND julianday(consumed_at) <= julianday('now', '-1 day')) )"),
    db.prepare("DELETE FROM auth_challenges WHERE julianday(expires_at) <= julianday('now') OR (consumed_at IS NOT NULL AND julianday(consumed_at) <= julianday('now', '-1 day'))"),
    db.prepare("DELETE FROM auth_federation_states WHERE julianday(expires_at) <= julianday('now') OR (consumed_at IS NOT NULL AND julianday(consumed_at) <= julianday('now', '-1 day'))"),
    db.prepare("DELETE FROM saml_request_cache WHERE julianday(created_at) <= julianday('now', '-1 day')"),
  ]);
}

/** Keep revoked session history available for a bounded period, but do not
 * retain expired authentication tokens indefinitely. Token hashes are not
 * useful after expiry and the session table is operational security data. */
export async function purgeExpiredAuthSessions(db: Pick<D1Database, "prepare">): Promise<void> {
  await db.prepare("DELETE FROM auth_sessions WHERE julianday(expires_at) <= julianday('now') OR (revoked_at IS NOT NULL AND julianday(revoked_at) <= julianday('now', '-30 days'))").run();
}
