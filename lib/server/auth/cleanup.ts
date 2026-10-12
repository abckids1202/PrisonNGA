const AUTH_CLEANUP_BATCH_SIZE = 250;

export async function purgeExpiredAuthArtifacts(db: Pick<D1Database, "prepare" | "batch">): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM auth_challenge_delivery_attempts
      WHERE rowid IN (
        SELECT rowid FROM auth_challenge_delivery_attempts
        WHERE challenge_id IN (
          SELECT id FROM auth_challenges
          WHERE julianday(expires_at) <= julianday('now')
             OR (consumed_at IS NOT NULL AND julianday(consumed_at) <= julianday('now', '-1 day'))
        )
        LIMIT ${AUTH_CLEANUP_BATCH_SIZE}
      )`),
    // The child delete above is bounded too. Only remove parent challenges
    // that no longer have delivery attempts, so foreign-key enforcement never
    // turns a large backlog into a failed all-or-nothing cleanup transaction.
    db.prepare(`DELETE FROM auth_challenges
      WHERE rowid IN (
        SELECT challenge.rowid FROM auth_challenges AS challenge
        WHERE (julianday(challenge.expires_at) <= julianday('now')
           OR (challenge.consumed_at IS NOT NULL AND julianday(challenge.consumed_at) <= julianday('now', '-1 day')))
          AND NOT EXISTS (
            SELECT 1 FROM auth_challenge_delivery_attempts AS attempt
            WHERE attempt.challenge_id = challenge.id
          )
        LIMIT ${AUTH_CLEANUP_BATCH_SIZE}
      )`),
    db.prepare(`DELETE FROM auth_federation_states
      WHERE rowid IN (
        SELECT rowid FROM auth_federation_states
        WHERE julianday(expires_at) <= julianday('now')
           OR (consumed_at IS NOT NULL AND julianday(consumed_at) <= julianday('now', '-1 day'))
        LIMIT ${AUTH_CLEANUP_BATCH_SIZE}
      )`),
    db.prepare(`DELETE FROM saml_request_cache
      WHERE rowid IN (
        SELECT rowid FROM saml_request_cache
        WHERE julianday(created_at) <= julianday('now', '-1 day')
        LIMIT ${AUTH_CLEANUP_BATCH_SIZE}
      )`),
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
 * useful after expiry and the session table is operational security data.
 *
 * This intentionally removes one bounded batch per scheduled invocation.
 * Authentication cleanup must not turn into an unbounded D1 transaction as
 * the session table grows; the next scheduled run continues from the
 * remaining rows. `rowid` is SQLite's stable internal key and is available
 * for this table even though the application uses a UUID as its public ID.
 */
export async function purgeExpiredAuthSessions(db: Pick<D1Database, "prepare">): Promise<void> {
  await db.prepare(`DELETE FROM auth_sessions
    WHERE rowid IN (
      SELECT rowid FROM auth_sessions
      WHERE julianday(expires_at) <= julianday('now')
         OR (revoked_at IS NOT NULL AND julianday(revoked_at) <= julianday('now', '-30 days'))
      LIMIT 250
    )`).run();
}

/**
 * Idempotency records are replay protection, not an audit archive. Retain
 * completed keys long enough to absorb delayed client retries, but prevent
 * the table from growing forever. Abandoned processing claims are retained
 * briefly for the normal reclaim path and then removed if the originating
 * invocation never returned.
 */
export async function purgeExpiredIdempotencyRecords(db: Pick<D1Database, "prepare">): Promise<void> {
  await db.prepare(`DELETE FROM idempotency_records
    WHERE rowid IN (
      SELECT rowid FROM idempotency_records
      WHERE (status = 'COMPLETED' AND completed_at IS NOT NULL AND julianday(completed_at) <= julianday('now', '-90 days'))
         OR (status = 'PROCESSING' AND julianday(COALESCE(processing_started_at, created_at)) <= julianday('now', '-7 days'))
      LIMIT ${AUTH_CLEANUP_BATCH_SIZE}
    )`).run();
}
