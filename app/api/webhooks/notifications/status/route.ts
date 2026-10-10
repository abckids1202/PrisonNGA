import { getD1 } from "../../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../../lib/server/events";
import { readTextBodyWithinLimit } from "../../../../../lib/server/request-body";
import { getRequestContext, getRuntimeValue, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";
import { enforceRateLimit } from "../../../../../lib/server/rate-limit";
import { operationalLog } from "../../../../../lib/server/observability";
import { verifyPaymentWebhookSignature } from "../../../../../lib/server/payments/provider";

const TERMINAL_SUCCESS = new Set(["DELIVERED"]);
const ACCEPTED_STATUS = "SENT";
const TERMINAL_FAILURE = new Set(["FAILED", "BOUNCED", "REJECTED", "UNDELIVERED", "INVALID_NUMBER"]);
const ALLOWED_STATUSES = new Set([...TERMINAL_SUCCESS, ACCEPTED_STATUS, ...TERMINAL_FAILURE, "QUEUED", "PROCESSING"]);

type DeliveryStatusPayload = { eventId: string; provider: string; providerReference: string; status: string; errorCode?: string; errorMessage?: string };

function normalizedText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function notificationStatus(status: string): "DELIVERED" | "FAILED" | null {
  if (TERMINAL_SUCCESS.has(status)) return "DELIVERED";
  if (TERMINAL_FAILURE.has(status)) return "FAILED";
  if (status === ACCEPTED_STATUS) return null;
  return null;
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const secret = await getRuntimeValue("NOTIFICATION_STATUS_WEBHOOK_SECRET");
    if (!secret) throw new SecurityError("NOTIFICATION_STATUS_WEBHOOK_NOT_CONFIGURED", 503);
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `notification-status-webhook:${context.ipAddress || "unknown"}`, limit: 300, windowSeconds: 60 });
    const rawBody = await readTextBodyWithinLimit(request, 64 * 1024);
    const timestamp = request.headers.get("x-securevisit-timestamp");
    // Missing environment must never downgrade an inbound provider callback
    // to development semantics. Staging/production require timestamped
    // signatures so replay protection remains fail-closed when deployment
    // configuration is incomplete.
    const environment = (await getRuntimeValue("SECUREVISIT_ENVIRONMENT")) || "unknown";
    if (environment !== "development" && !timestamp) throw new SecurityError("NOTIFICATION_STATUS_TIMESTAMP_REQUIRED", 401);
    if (!await verifyPaymentWebhookSignature(rawBody, request.headers.get("x-securevisit-signature"), secret, timestamp)) throw new SecurityError("NOTIFICATION_STATUS_SIGNATURE_INVALID", 401);
    let input: unknown;
    try { input = JSON.parse(rawBody); } catch { throw new SecurityError("NOTIFICATION_STATUS_INVALID", 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new SecurityError("NOTIFICATION_STATUS_INVALID", 400);
    const body = input as Record<string, unknown>;
    const payload: DeliveryStatusPayload = {
      eventId: normalizedText(body.eventId, 256),
      provider: normalizedText(body.provider, 64).toLowerCase(),
      providerReference: normalizedText(body.providerReference, 256),
      status: normalizedText(body.status, 40).toUpperCase(),
      errorCode: normalizedText(body.errorCode, 120) || undefined,
      errorMessage: normalizedText(body.errorMessage, 500) || undefined,
    };
    if (!payload.eventId || !payload.provider || !payload.providerReference || !ALLOWED_STATUSES.has(payload.status)) throw new SecurityError("NOTIFICATION_STATUS_INVALID", 400);
    const snapshot = JSON.stringify(payload);
    const inserted = await d1.prepare(`INSERT OR IGNORE INTO notification_provider_events (id, provider, event_key, provider_reference, status, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), payload.provider, payload.eventId, payload.providerReference, payload.status, snapshot, new Date().toISOString()).run();
    if (!inserted.meta.changes) return securityResponse({ accepted: true, idempotent: true, eventId: payload.eventId }, 200, context.requestId);
    const nextStatus = notificationStatus(payload.status);
    const now = new Date().toISOString();
    const notification = await d1.prepare(`SELECT nda.id, nda.notification_id, nda.status, oe.facility_id, oe.event_type
      FROM notification_delivery_attempts nda INNER JOIN outbox_events oe ON oe.id = nda.outbox_event_id
      WHERE nda.provider_reference = ? AND nda.provider = ? ORDER BY nda.started_at DESC LIMIT 1`).bind(payload.providerReference, payload.provider).first<{ id: string; notification_id: string; status: string; facility_id: string | null; event_type: string }>();
    const challenge = await d1.prepare(`SELECT id, challenge_id, status FROM auth_challenge_delivery_attempts WHERE provider_reference = ? AND provider = ? ORDER BY created_at DESC LIMIT 1`).bind(payload.providerReference, payload.provider).first<{ id: string; challenge_id: string; status: string }>();
    if (!notification && !challenge) return securityResponse({ accepted: true, matched: false, eventId: payload.eventId }, 202, context.requestId);
    const statements: D1PreparedStatement[] = [];
    if (notification) {
      statements.push(d1.prepare(`UPDATE notification_delivery_attempts SET provider_status = ?, provider_error = ?, status_updated_at = ?, status = CASE WHEN status IN ('DELIVERED', 'FAILED') THEN status WHEN ? = 'DELIVERED' THEN 'DELIVERED' WHEN ? = 'FAILED' THEN 'FAILED' ELSE status END, error_message = CASE WHEN ? = 'FAILED' THEN COALESCE(?, error_message) ELSE error_message END, finished_at = CASE WHEN status IN ('DELIVERED', 'FAILED') THEN finished_at WHEN ? IN ('DELIVERED', 'FAILED') THEN ? ELSE finished_at END WHERE id = ?`).bind(payload.status, payload.errorMessage || payload.errorCode || null, now, nextStatus, nextStatus, nextStatus, payload.errorMessage || payload.errorCode || null, nextStatus, now, notification.id));
      if (nextStatus) statements.push(d1.prepare(`UPDATE notifications SET status = CASE WHEN status IN ('DELIVERED', 'FAILED') THEN status ELSE ? END, delivered_at = CASE WHEN ? = 'DELIVERED' AND status NOT IN ('DELIVERED', 'FAILED') THEN ? ELSE delivered_at END, last_error = CASE WHEN ? = 'FAILED' AND status NOT IN ('DELIVERED', 'FAILED') THEN COALESCE(?, last_error) ELSE last_error END WHERE id = ? AND channel <> 'IN_APP'`).bind(nextStatus, nextStatus, now, nextStatus, payload.errorMessage || payload.errorCode || null, notification.notification_id));
      if (notification.facility_id) statements.push(...auditAndOutboxStatements(d1, { actorUserId: "system:notification-webhook", actorRole: "SYSTEM", facilityId: notification.facility_id, actionType: "NOTIFICATION_DELIVERY_STATUS_UPDATED", entityType: "notification_delivery_attempt", entityId: notification.id, reason: `Provider reported ${payload.status}.`, oldValues: { status: notification.status }, newValues: { providerStatus: payload.status, status: nextStatus || notification.status, providerReference: payload.providerReference }, requestId: context.requestId, correlationId: payload.eventId, eventType: "NOTIFICATION_DELIVERY_STATUS_UPDATED", payload: { provider: payload.provider, providerReference: payload.providerReference, status: payload.status, eventType: notification.event_type } }));
    }
    if (challenge) {
      statements.push(d1.prepare(`UPDATE auth_challenge_delivery_attempts SET provider_status = ?, provider_error = ?, status_updated_at = ?, status = CASE WHEN ? = 'FAILED' THEN 'FAILED' ELSE status END, error_code = CASE WHEN ? = 'FAILED' THEN COALESCE(?, error_code) ELSE error_code END, completed_at = CASE WHEN ? = 'FAILED' THEN ? ELSE completed_at END WHERE id = ?`).bind(payload.status, payload.errorMessage || payload.errorCode || null, now, nextStatus, nextStatus, payload.errorMessage || payload.errorCode || null, nextStatus, now, challenge.id));
      if (nextStatus === "FAILED") statements.push(d1.prepare("UPDATE auth_challenges SET expires_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?").bind(now, challenge.challenge_id, now));
    }
    const results = await d1.batch(statements);
    if (notification && !results[0]?.meta.changes) throw new SecurityError("NOTIFICATION_STATUS_NOT_APPLIED", 503);
    operationalLog("info", { event: "NOTIFICATION_PROVIDER_STATUS_APPLIED", provider: payload.provider, providerReference: payload.providerReference, status: payload.status, correlationId: payload.eventId, requestId: context.requestId });
    return securityResponse({ accepted: true, matched: true, status: payload.status, eventId: payload.eventId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
