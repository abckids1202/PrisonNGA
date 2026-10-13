import { auditAndOutboxStatements } from "../events";

const TERMINAL_FAILURES = new Set(["FAILED", "BOUNCED", "REJECTED", "UNDELIVERED", "INVALID_NUMBER"]);

type StoredProviderEvent = {
  provider: string;
  provider_reference: string;
  status: string;
  payload: string;
};

function nextNotificationStatus(status: string): "DELIVERED" | "FAILED" | null {
  if (status === "DELIVERED") return "DELIVERED";
  if (TERMINAL_FAILURES.has(status)) return "FAILED";
  return null;
}

function providerErrorFromPayload(payload: string, status: string): string | null {
  if (nextNotificationStatus(status) !== "FAILED") return null;
  try {
    const parsed = JSON.parse(payload) as { errorMessage?: unknown; errorCode?: unknown };
    const message = typeof parsed.errorMessage === "string" ? parsed.errorMessage.trim() : "";
    const code = typeof parsed.errorCode === "string" ? parsed.errorCode.trim() : "";
    return (message || code).slice(0, 500) || null;
  } catch {
    return null;
  }
}

/**
 * Apply a provider callback that arrived before the outbox worker persisted
 * the provider reference. The callback endpoint intentionally acknowledges
 * unmatched events so providers do not retry forever; this reconciliation
 * closes the small but consequential acceptance/persistence race.
 */
export async function reconcileStoredNotificationProviderEvent(
  d1: D1Database,
  input: { provider: string; providerReference: string; requestId?: string },
): Promise<boolean> {
  const event = await d1.prepare(`SELECT provider, provider_reference, status, payload
    FROM notification_provider_events
    WHERE provider = ? AND provider_reference = ?
    ORDER BY created_at DESC LIMIT 1`).bind(input.provider, input.providerReference).first<StoredProviderEvent>();
  if (!event) return false;

  const notification = await d1.prepare(`SELECT nda.id, nda.notification_id, nda.status, oe.facility_id, oe.event_type
    FROM notification_delivery_attempts nda
    INNER JOIN outbox_events oe ON oe.id = nda.outbox_event_id
    WHERE nda.provider_reference = ? AND nda.provider = ?
    ORDER BY nda.started_at DESC LIMIT 1`).bind(input.providerReference, input.provider).first<{ id: string; notification_id: string; status: string; facility_id: string | null; event_type: string }>();
  const challenge = await d1.prepare(`SELECT id, challenge_id, status
    FROM auth_challenge_delivery_attempts
    WHERE provider_reference = ? AND provider = ?
    ORDER BY created_at DESC LIMIT 1`).bind(input.providerReference, input.provider).first<{ id: string; challenge_id: string; status: string }>();
  if (!notification && !challenge) return false;

  const nextStatus = nextNotificationStatus(event.status);
  const providerError = providerErrorFromPayload(event.payload, event.status);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (notification) {
    statements.push(d1.prepare(`UPDATE notification_delivery_attempts
      SET provider_status = ?, provider_error = ?, status_updated_at = ?,
        status = CASE WHEN status IN ('DELIVERED', 'FAILED') THEN status
          WHEN ? = 'DELIVERED' THEN 'DELIVERED'
          WHEN ? = 'FAILED' THEN 'FAILED' ELSE status END,
        finished_at = CASE WHEN status IN ('DELIVERED', 'FAILED') THEN finished_at
          WHEN ? IN ('DELIVERED', 'FAILED') THEN ? ELSE finished_at END
      WHERE id = ?`).bind(event.status, providerError, now, nextStatus, nextStatus, nextStatus, now, notification.id));
    if (nextStatus) {
      statements.push(d1.prepare(`UPDATE notifications SET
        status = CASE WHEN status IN ('DELIVERED', 'FAILED') THEN status ELSE ? END,
        delivered_at = CASE WHEN ? = 'DELIVERED' AND status NOT IN ('DELIVERED', 'FAILED') THEN ? ELSE delivered_at END
        WHERE id = ? AND channel <> 'IN_APP'`).bind(nextStatus, nextStatus, now, notification.notification_id));
    }
    if (notification.facility_id) {
      statements.push(...auditAndOutboxStatements(d1, {
        actorUserId: "system:notification-reconciliation",
        actorRole: "SYSTEM",
        facilityId: notification.facility_id,
        actionType: "NOTIFICATION_DELIVERY_STATUS_RECONCILED",
        entityType: "notification_delivery_attempt",
        entityId: notification.id,
        reason: `Reconciled provider callback ${event.status} received before provider reference persistence.`,
        newValues: { provider: input.provider, providerReference: input.providerReference, status: event.status },
        requestId: input.requestId || `notification-reconciliation:${input.providerReference}`,
        correlationId: `notification-status:${input.provider}:${input.providerReference}`,
        eventType: "NOTIFICATION_DELIVERY_STATUS_RECONCILED",
        payload: { provider: input.provider, providerReference: input.providerReference, status: event.status, sourcePayload: event.payload },
      }));
    }
  }
  if (challenge) {
    statements.push(d1.prepare(`UPDATE auth_challenge_delivery_attempts
      SET provider_status = ?, provider_error = ?, status_updated_at = ?,
        status = CASE
          WHEN status IN ('DELIVERED', 'FAILED') THEN status
          WHEN ? IN ('DELIVERED', 'FAILED') THEN ?
          ELSE status
        END,
        completed_at = CASE
          WHEN status IN ('DELIVERED', 'FAILED') THEN completed_at
          WHEN ? IN ('DELIVERED', 'FAILED') THEN ?
          ELSE completed_at
        END
      WHERE id = ?`).bind(event.status, providerError, now, nextStatus, nextStatus, nextStatus, now, challenge.id));
    if (nextStatus === "FAILED") {
      statements.push(d1.prepare(`UPDATE auth_challenges SET expires_at = ?
        WHERE id = ? AND consumed_at IS NULL AND expires_at > ?`).bind(now, challenge.challenge_id, now));
    }
  }
  const results = await d1.batch(statements);
  return results.length > 0 && Boolean(results[0]?.meta.changes);
}
