/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { validateEnvironment } from "../lib/server/config";
import { finalizeLiveSessionStatements, getExpiredSessionDisposition } from "../lib/server/live-session-finalization";
import { createLiveKitProvider } from "../lib/server/video/provider";
import { deliverNotification, getNotificationDelivery } from "../lib/server/notifications/provider";
import { resolveOutboxVisitorRecipient } from "../lib/server/notifications/outbox";
import { purgeExpiredAuthArtifacts } from "../lib/server/auth/cleanup";
import { processPaymentProviderEvent } from "../lib/server/payments/process-event";
import { appointmentDecisionStatements } from "../lib/server/appointment-decisions";
import { isSameOriginMutation } from "../lib/server/csrf";
import { claimExpiredEvidenceRetentionStatement, expiredEvidenceRetentionStatements, restoreClaimedEvidenceRetentionStatement } from "../lib/server/retention-workflow";
import { operationalLog } from "../lib/server/observability";
import { purgeStaleRateLimitBuckets } from "../lib/server/rate-limit-cleanup";
import { auditAndOutboxStatements } from "../lib/server/events";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  EVIDENCE_BUCKET?: R2Bucket;
  [key: string]: unknown;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function liveKitConnectSources(env: Env): string {
  const sources = new Set(["https://*.livekit.cloud", "wss://*.livekit.cloud", "https://*.livekit.io", "wss://*.livekit.io"]);
  const configuredUrl = typeof env.LIVEKIT_URL === "string" ? env.LIVEKIT_URL.trim() : "";
  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      if (parsed.protocol === "https:" || parsed.protocol === "wss:") {
        const origin = `${parsed.protocol}//${parsed.host}`;
        sources.add(origin);
        sources.add(`${parsed.protocol === "https:" ? "wss:" : "https:"}//${parsed.host}`);
      }
    } catch { /* Invalid provider configuration is reported by readiness validation. */ }
  }
  return [...sources].join(" ");
}

type OutboxRow = { id: string; event_type: string; aggregate_type: string; aggregate_id: string | null; facility_id: string | null; payload: string; correlation_id: string; attempt_count: number };
type ExpiredSession = { id: string; appointment_id: string; facility_id: string; visitor_user_id: string; version: number; appointment_version: number; status: string; actual_started_at: string | null; termination_reason: string | null; provider_room_name: string; credit_account_id: string | null };
type PaymentRetryEvent = { id: string; provider: string; event_key: string; event_type: string; payload: string; attempt_count: number };
type AbandonedPaymentIntent = { id: string; facility_id: string; user_id: string; credit_quantity: number; amount_minor: number; currency: string; version: number };

async function reconcileWaitingRoomNoShows(env: Env): Promise<void> {
  const rows = await env.DB.prepare(`SELECT a.id, a.facility_id, a.visitor_user_id, a.status, a.version, a.requested_end,
      ca.id AS credit_account_id
    FROM appointments a
    LEFT JOIN waiting_room_sessions w ON w.appointment_id = a.id AND w.facility_id = a.facility_id
    LEFT JOIN visit_sessions vs ON vs.appointment_id = a.id AND vs.facility_id = a.facility_id
      AND vs.status IN ('CONNECTING', 'ACTIVE', 'RECONNECTING', 'ENDING')
    LEFT JOIN credit_accounts ca ON ca.user_id = a.visitor_user_id AND ca.facility_id = a.facility_id
    WHERE a.status IN ('APPROVED', 'WAITING')
      AND julianday(a.requested_end) <= julianday('now')
      AND vs.id IS NULL
      -- A stored presence is only meaningful while its heartbeat is fresh.
      -- Otherwise a disconnected browser or kiosk could block no-show cleanup forever.
      AND NOT (w.visitor_presence = 'present' AND julianday(w.visitor_presence_at) >= julianday('now', '-3 minutes'))
      AND NOT (w.prisoner_presence = 'present' AND julianday(w.prisoner_presence_at) >= julianday('now', '-3 minutes'))
    ORDER BY a.requested_end ASC LIMIT 25`).all<{ id: string; facility_id: string; visitor_user_id: string; status: string; version: number; requested_end: string; credit_account_id: string | null }>();

  for (const row of rows.results) {
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    try {
      const results = await env.DB.batch(appointmentDecisionStatements(env.DB, {
        appointmentId: row.id,
        facilityId: row.facility_id,
        visitorUserId: row.visitor_user_id,
        fromStatus: row.status,
        toStatus: "NO_SHOW",
        expectedVersion: row.version,
        actorUserId: "system:scheduler",
        actorRole: "SYSTEM",
        command: "no_show",
        reason: `Visit window ended at ${row.requested_end} without participant arrival.`,
        requestId: correlationId,
        correlationId,
        now,
        creditAccountId: row.credit_account_id || undefined,
      }));
      if (!results[0]?.meta.changes) continue;
    } catch (error) {
      operationalLog("error", { event: "WAITING_ROOM_NO_SHOW_RECONCILIATION_FAILED", appointmentId: row.id, facilityId: row.facility_id, correlationId, error });
    }
  }
}

async function reconcilePaymentEvents(env: Env): Promise<void> {
  await env.DB.prepare(`UPDATE payment_provider_events
    SET status = 'FAILED', available_at = CURRENT_TIMESTAMP, processing_started_at = NULL, last_error = 'Recovered stale processing claim.'
    WHERE status = 'PROCESSING' AND processing_started_at IS NOT NULL AND julianday(processing_started_at) < julianday('now', '-5 minutes')`).run();
  const rows = await env.DB.prepare("SELECT id, provider, event_key, event_type, payload, attempt_count FROM payment_provider_events WHERE status IN ('RECEIVED', 'FAILED') AND julianday(available_at) <= julianday('now') ORDER BY created_at ASC LIMIT 25").all<PaymentRetryEvent>();
  for (const row of rows.results) {
    const claim = await env.DB.prepare("UPDATE payment_provider_events SET status = 'PROCESSING', attempt_count = attempt_count + 1, processing_started_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ? AND status IN ('RECEIVED', 'FAILED') AND julianday(available_at) <= julianday('now')").bind(row.id).run();
    if (!claim.meta.changes) continue;
    try {
      const payload = JSON.parse(row.payload) as { eventType?: unknown; paymentIntentId?: unknown; providerReference?: unknown; status?: unknown; amountMinor?: unknown; currency?: unknown };
      if (typeof payload.eventType !== "string") throw new Error("PAYMENT_EVENT_INVALID_SNAPSHOT");
      await processPaymentProviderEvent(env.DB, {
        provider: row.provider,
        eventKey: row.event_key,
        payload: {
          eventId: row.event_key,
          eventType: payload.eventType,
          paymentIntentId: typeof payload.paymentIntentId === "string" ? payload.paymentIntentId : undefined,
          providerReference: typeof payload.providerReference === "string" ? payload.providerReference : undefined,
          status: typeof payload.status === "string" ? payload.status : undefined,
          amountMinor: typeof payload.amountMinor === "number" && Number.isSafeInteger(payload.amountMinor) ? payload.amountMinor : undefined,
          currency: typeof payload.currency === "string" ? payload.currency : undefined,
        },
      });
    } catch (error) {
      const attempt = row.attempt_count + 1;
      const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, attempt - 1)));
      const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      const message = error instanceof Error ? error.message.slice(0, 500) : "PAYMENT_EVENT_RECONCILIATION_FAILED";
      await env.DB.prepare("UPDATE payment_provider_events SET status = CASE WHEN attempt_count >= 8 THEN 'DEAD_LETTER' ELSE 'FAILED' END, available_at = ?, processing_started_at = NULL, last_error = ? WHERE id = ? AND status = 'PROCESSING'").bind(nextAttemptAt, message, row.id).run();
      operationalLog("error", { event: "PAYMENT_EVENT_RECONCILIATION_FAILED", eventId: row.id, provider: row.provider, attempt, correlationId: row.event_key, error: message });
    }
  }
}

async function expireAbandonedPaymentIntents(env: Env): Promise<void> {
  const rows = await env.DB.prepare(`SELECT id, facility_id, user_id, credit_quantity, amount_minor, currency, version
    FROM payment_intents
    WHERE status = 'PENDING' AND julianday(created_at) <= julianday('now', '-30 minutes')
    ORDER BY created_at ASC LIMIT 25`).all<AbandonedPaymentIntent>();
  for (const row of rows.results) {
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    try {
      const results = await env.DB.batch([
        env.DB.prepare(`UPDATE payment_intents SET status = 'EXPIRED', version = version + 1, updated_at = ?
          WHERE id = ? AND facility_id = ? AND status = 'PENDING' AND version = ?`)
          .bind(now, row.id, row.facility_id, row.version),
        ...auditAndOutboxStatements(env.DB, {
          actorUserId: "system:scheduler",
          actorRole: "SYSTEM",
          facilityId: row.facility_id,
          actionType: "PAYMENT_EXPIRED",
          entityType: "payment_intent",
          entityId: row.id,
          reason: "Payment intent remained pending before checkout creation beyond the retry window.",
          oldValues: { status: "PENDING", version: row.version },
          newValues: { status: "EXPIRED", version: row.version + 1 },
          requestId: correlationId,
          correlationId,
          eventType: "PAYMENT_STATUS_UPDATED",
          payload: { paymentIntentId: row.id, visitorUserId: row.user_id, status: "EXPIRED", creditQuantity: row.credit_quantity, amountMinor: row.amount_minor, currency: row.currency },
        }, { sql: "EXISTS (SELECT 1 FROM payment_intents WHERE id = ? AND facility_id = ? AND status = 'EXPIRED' AND version = ?)", values: [row.id, row.facility_id, row.version + 1] }),
      ]);
      if (!results[0]?.meta.changes) continue;
    } catch (error) {
      operationalLog("error", { event: "ABANDONED_PAYMENT_EXPIRY_FAILED", paymentIntentId: row.id, facilityId: row.facility_id, correlationId, error });
    }
  }
}

async function processOutbox(env: Env): Promise<void> {
  await env.DB.prepare("UPDATE outbox_events SET status = 'FAILED', available_at = CURRENT_TIMESTAMP, processing_started_at = NULL, last_error = 'Recovered stale processing claim.' WHERE status = 'PROCESSING' AND processing_started_at IS NOT NULL AND processing_started_at < datetime('now', '-5 minutes')").run();
  await env.DB.prepare(`UPDATE notification_delivery_attempts
    SET status = 'FAILED', error_message = 'Recovered stale outbox claim.', finished_at = CURRENT_TIMESTAMP
    WHERE status = 'PROCESSING'
      AND EXISTS (
        SELECT 1 FROM outbox_events
        WHERE outbox_events.id = notification_delivery_attempts.outbox_event_id
          AND outbox_events.status = 'FAILED'
          AND outbox_events.last_error = 'Recovered stale processing claim.'
      )`).run();
  const result = await env.DB.prepare("SELECT id, event_type, aggregate_type, aggregate_id, facility_id, payload, correlation_id, attempt_count FROM outbox_events WHERE status IN ('PENDING', 'FAILED') AND julianday(available_at) <= julianday('now') ORDER BY created_at ASC LIMIT 25").all<OutboxRow>();
  for (const row of result.results) {
    const now = new Date().toISOString();
    try {
      // Claim before parsing or doing any external work. Otherwise a malformed
      // payload remains PENDING forever because the failure handler only
      // updates rows that have already entered PROCESSING.
      const claim = await env.DB.prepare("UPDATE outbox_events SET status = 'PROCESSING', attempt_count = attempt_count + 1, processing_started_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ? AND status IN ('PENDING', 'FAILED') AND julianday(available_at) <= julianday('now')").bind(row.id).run();
      if (!claim.meta.changes) continue;
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      const attemptNumber = row.attempt_count + 1;
      const attemptStartedAt = new Date().toISOString();
      const externalAttemptId = `${row.id}:external:${attemptNumber}`;
      const inAppAttemptId = `${row.id}:in-app:${attemptNumber}`;
      await env.DB.batch([
        env.DB.prepare(`INSERT OR IGNORE INTO notification_delivery_attempts
          (id, outbox_event_id, notification_id, channel, attempt_number, status, started_at)
          VALUES (?, ?, ?, 'EXTERNAL', ?, 'PROCESSING', ?)`)
          .bind(externalAttemptId, row.id, row.id, attemptNumber, attemptStartedAt),
        env.DB.prepare(`INSERT OR IGNORE INTO notification_delivery_attempts
          (id, outbox_event_id, notification_id, channel, attempt_number, status, started_at)
          VALUES (?, ?, ?, 'IN_APP', ?, 'PROCESSING', ?)`)
          .bind(inAppAttemptId, row.id, `${row.id}:in-app`, attemptNumber, attemptStartedAt),
      ]);
      const visitorUserId = await resolveOutboxVisitorRecipient(env.DB, row);
      const declaredVisitorUserId = typeof payload.visitorUserId === "string" ? payload.visitorUserId : null;
      if (declaredVisitorUserId && declaredVisitorUserId !== visitorUserId) {
        throw new Error("OUTBOX_RECIPIENT_MISMATCH");
      }
      if (visitorUserId) {
        const copy = notificationCopy(row.event_type, payload);
        const notificationPayload = { aggregateId: row.aggregate_id, correlationId: row.correlation_id, ...payload };
        const notificationDelivery = await getNotificationDelivery();
        if (notificationDelivery === "webhook") {
          const visitor = await env.DB.prepare("SELECT email, phone, email_verified_at, phone_verified_at FROM users WHERE id = ? AND user_type = 'VISITOR' AND status = 'ACTIVE'").bind(visitorUserId).first<{ email: string | null; phone: string | null; email_verified_at: string | null; phone_verified_at: string | null }>();
          if (!visitor) throw new Error("NOTIFICATION_RECIPIENT_NOT_FOUND");
          const channel = visitor.email_verified_at && visitor.email ? "EMAIL" : visitor.phone_verified_at && visitor.phone ? "SMS" : null;
          if (!channel) throw new Error("NOTIFICATION_RECIPIENT_NOT_FOUND");
          const externalNotificationKey = `${row.id}:visitor:${channel.toLowerCase()}`;
          const alreadyDelivered = await env.DB.prepare("SELECT id FROM notifications WHERE idempotency_key = ? AND status = 'DELIVERED' LIMIT 1").bind(externalNotificationKey).first<{ id: string }>();
          if (!alreadyDelivered) {
            await deliverNotification({ notificationId: row.id, email: channel === "EMAIL" ? visitor.email : null, phone: channel === "SMS" ? visitor.phone : null, template: row.event_type, title: copy.title, body: copy.body, payload: notificationPayload });
            await env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, facility_id, user_id, channel, template, title, body, payload, status, attempt_count, available_at, delivered_at, idempotency_key, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DELIVERED', 1, ?, ?, ?, ?)`).bind(`${row.id}:${channel.toLowerCase()}`, row.facility_id, visitorUserId, channel, row.event_type, copy.title, copy.body, JSON.stringify(notificationPayload), now, now, externalNotificationKey, now).run();
          }
          await env.DB.prepare("UPDATE notification_delivery_attempts SET status = 'DELIVERED', finished_at = ? WHERE id = ? AND status = 'PROCESSING'").bind(now, externalAttemptId).run();
        } else {
          await env.DB.prepare("UPDATE notification_delivery_attempts SET status = 'SKIPPED', error_message = 'External delivery is not configured for this environment.', finished_at = ? WHERE id = ? AND status = 'PROCESSING'").bind(now, externalAttemptId).run();
        }
        await env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, facility_id, user_id, channel, template, title, body, payload, status, attempt_count, available_at, delivered_at, idempotency_key, created_at)
          VALUES (?, ?, ?, 'IN_APP', ?, ?, ?, ?, 'DELIVERED', 1, ?, ?, ?, ?)`).bind(`${row.id}:in-app`, row.facility_id, visitorUserId, row.event_type, copy.title, copy.body, JSON.stringify(notificationPayload), now, now, `${row.id}:visitor:in-app`, now).run();
        await env.DB.prepare("UPDATE notification_delivery_attempts SET status = 'DELIVERED', finished_at = ? WHERE id = ? AND status = 'PROCESSING'").bind(now, inAppAttemptId).run();
      } else {
        await env.DB.prepare("UPDATE notification_delivery_attempts SET status = 'SKIPPED', error_message = 'No visitor recipient associated with event.', finished_at = ? WHERE outbox_event_id = ? AND attempt_number = ? AND status = 'PROCESSING'").bind(now, row.id, attemptNumber).run();
      }
      await env.DB.prepare("UPDATE outbox_events SET status = 'PROCESSED', processing_started_at = NULL, processed_at = ? WHERE id = ? AND status = 'PROCESSING'").bind(now, row.id).run();
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "OUTBOX_PROCESSING_FAILED";
      const attempt = row.attempt_count + 1;
      const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, attempt - 1)));
      const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      await env.DB.prepare("UPDATE notification_delivery_attempts SET status = 'FAILED', error_message = ?, finished_at = ? WHERE outbox_event_id = ? AND attempt_number = ? AND status = 'PROCESSING'").bind(message, now, row.id, attempt).run();
      await env.DB.prepare("UPDATE outbox_events SET status = CASE WHEN attempt_count >= 5 THEN 'DEAD_LETTER' ELSE 'FAILED' END, available_at = ?, processing_started_at = NULL, last_error = ? WHERE id = ? AND status = 'PROCESSING'").bind(nextAttemptAt, message, row.id).run();
      operationalLog("error", { event: attempt >= 5 ? "NOTIFICATION_OUTBOX_DEAD_LETTER" : "NOTIFICATION_OUTBOX_RETRY_SCHEDULED", outboxEventId: row.id, eventType: row.event_type, facilityId: row.facility_id, correlationId: row.correlation_id, attempt, error: message });
    }
  }
}

async function purgeExpiredEvidence(env: Env): Promise<void> {
  if (!env.EVIDENCE_BUCKET) return;
  await env.DB.prepare("UPDATE evidence_documents SET status = 'AVAILABLE', updated_at = CURRENT_TIMESTAMP WHERE status = 'PENDING_DELETION' AND legal_hold = 1").run();
  const rows = await env.DB.prepare("SELECT id, facility_id, storage_key, retention_until, status FROM evidence_documents WHERE legal_hold = 0 AND ((status = 'AVAILABLE' AND julianday(retention_until) <= julianday('now')) OR status = 'PENDING_DELETION') LIMIT 50").all<{ id: string; facility_id: string; storage_key: string; retention_until: string; status: string }>();
  for (const row of rows.results) {
    const correlationId = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      if (row.status === "AVAILABLE") {
        const claimed = await env.DB.batch([claimExpiredEvidenceRetentionStatement(env.DB, { id: row.id, facilityId: row.facility_id, now })]);
        if (!claimed[0]?.meta.changes) continue;
      }
      const latest = await env.DB.prepare("SELECT status, legal_hold FROM evidence_documents WHERE id = ? AND facility_id = ?").bind(row.id, row.facility_id).first<{ status: string; legal_hold: number }>();
      if (!latest || latest.status !== "PENDING_DELETION" || latest.legal_hold) {
        if (latest?.status === "PENDING_DELETION") await env.DB.batch([restoreClaimedEvidenceRetentionStatement(env.DB, { id: row.id, facilityId: row.facility_id, now })]);
        continue;
      }
      await env.EVIDENCE_BUCKET.delete(row.storage_key);
      await env.DB.batch(expiredEvidenceRetentionStatements(env.DB, {
        id: row.id,
        facilityId: row.facility_id,
        storageKey: row.storage_key,
        retentionUntil: row.retention_until,
        requestId: correlationId,
        correlationId,
        now,
        claimed: true,
      }));
    } catch (error) {
      try { await env.DB.batch([restoreClaimedEvidenceRetentionStatement(env.DB, { id: row.id, facilityId: row.facility_id, now: new Date().toISOString() })]); } catch { /* Keep the original retention error; the next worker run can recover the claim. */ }
      operationalLog("error", { event: "EVIDENCE_RETENTION_DELETE_FAILED", evidenceId: row.id, facilityId: row.facility_id, requestId: correlationId, correlationId, error });
    }
  }
}

async function purgeExpiredStepUpAssertions(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM step_up_assertions WHERE julianday(expires_at) <= julianday('now')").run();
}

async function expireBreakGlassRequests(env: Env): Promise<void> {
  const rows = await env.DB.prepare(`SELECT id, facility_id, target_type, target_id, version
    FROM break_glass_requests WHERE status = 'APPROVED' AND expires_at IS NOT NULL AND julianday(expires_at) <= julianday('now') LIMIT 50`)
    .all<{ id: string; facility_id: string; target_type: string; target_id: string; version: number }>();
  for (const row of rows.results) {
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    try {
      const results = await env.DB.batch([
        env.DB.prepare("UPDATE break_glass_requests SET status = 'EXPIRED', version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND status = 'APPROVED' AND version = ?")
          .bind(now, row.id, row.facility_id, row.version),
        ...auditAndOutboxStatements(env.DB, {
          actorUserId: "system:scheduler",
          actorRole: "SYSTEM",
          facilityId: row.facility_id,
          actionType: "BREAK_GLASS_EXPIRED",
          entityType: "break_glass_request",
          entityId: row.id,
          reason: "The approved emergency-access window elapsed.",
          oldValues: { status: "APPROVED", version: row.version },
          newValues: { status: "EXPIRED", version: row.version + 1, targetType: row.target_type, targetId: row.target_id },
          requestId: correlationId,
          correlationId,
          eventType: "BREAK_GLASS_EXPIRED",
          payload: { requestId: row.id, targetType: row.target_type, targetId: row.target_id },
        }, { sql: "EXISTS (SELECT 1 FROM break_glass_requests WHERE id = ? AND status = 'EXPIRED' AND version = ?)", values: [row.id, row.version + 1] }),
      ]);
      if (!results[0]?.meta.changes) continue;
    } catch (error) {
      operationalLog("error", { event: "BREAK_GLASS_EXPIRY_FAILED", requestId: row.id, facilityId: row.facility_id, correlationId, error });
    }
  }
}

async function recordSessionProviderCloseFailure(env: Env, session: ExpiredSession, reason: string): Promise<void> {
  try {
    const priorFailure = await env.DB.prepare("SELECT 1 AS present FROM audit_events WHERE facility_id = ? AND action_type = 'LIVE_SESSION_PROVIDER_CLOSE_FAILED' AND entity_type = 'visit_session' AND entity_id = ? LIMIT 1")
      .bind(session.facility_id, session.id).first<{ present: number }>();
    if (priorFailure) return;
    const correlationId = crypto.randomUUID();
    await env.DB.batch(auditAndOutboxStatements(env.DB, {
      actorUserId: "system:scheduler",
      actorRole: "SYSTEM",
      facilityId: session.facility_id,
      actionType: "LIVE_SESSION_PROVIDER_CLOSE_FAILED",
      entityType: "visit_session",
      entityId: session.id,
      reason,
      oldValues: { sessionStatus: session.status, providerRoomName: session.provider_room_name },
      newValues: { interventionRequired: true, retryable: true },
      requestId: correlationId,
      correlationId,
      eventType: "LIVE_SESSION_PROVIDER_CLOSE_FAILED",
      payload: { sessionId: session.id, appointmentId: session.appointment_id, visitorUserId: session.visitor_user_id, retryable: true },
    }));
  } catch (auditError) {
    operationalLog("error", { event: "EXPIRED_SESSION_CLOSE_FAILURE_AUDIT_FAILED", sessionId: session.id, facilityId: session.facility_id, actorId: "system:scheduler", error: auditError });
  }
}

async function reconcileExpiredSessions(env: Env): Promise<void> {
    const sessions = await env.DB.prepare(`SELECT vs.id, vs.appointment_id, vs.facility_id, a.visitor_user_id, vs.version, vs.status, vs.actual_started_at,
      vs.termination_reason, vs.provider_room_name, a.version AS appointment_version, ca.id AS credit_account_id
    FROM visit_sessions vs INNER JOIN appointments a ON a.id = vs.appointment_id AND a.facility_id = vs.facility_id
    LEFT JOIN credit_accounts ca ON ca.user_id = a.visitor_user_id AND ca.facility_id = a.facility_id
    WHERE a.status = 'IN_PROGRESS' AND (
      (vs.status = 'ENDING' AND julianday(vs.updated_at) <= julianday('now', '-1 minute'))
      OR (vs.status IN ('CONNECTING', 'ACTIVE', 'RECONNECTING') AND julianday(vs.authorized_end_at) <= julianday('now'))
    ) LIMIT 25`).all<ExpiredSession>();
  if (!sessions.results.length) return;

  let provider: Awaited<ReturnType<typeof createLiveKitProvider>>;
  try {
    provider = await createLiveKitProvider();
  } catch (error) {
    operationalLog("error", { event: "EXPIRED_SESSION_PROVIDER_UNAVAILABLE", actorId: "system:scheduler", error });
    for (const session of sessions.results) {
      await recordSessionProviderCloseFailure(env, session, "The video provider was unavailable while the authorized session window expired.");
    }
    return;
  }

  for (const session of sessions.results) {
    const now = new Date().toISOString();
    try {
      await provider.endRoom(session.provider_room_name);
    } catch (error) {
      operationalLog("error", { event: "EXPIRED_SESSION_ROOM_CLOSE_FAILED", sessionId: session.id, facilityId: session.facility_id, actorId: "system:scheduler", error });
      await recordSessionProviderCloseFailure(env, session, "The video provider did not confirm room closure after the authorized session window expired.");
      continue;
    }
    if (!session.credit_account_id) {
      operationalLog("error", { event: "EXPIRED_SESSION_CREDIT_ACCOUNT_MISSING", sessionId: session.id, appointmentId: session.appointment_id, facilityId: session.facility_id, actorId: "system:scheduler" });
      continue;
    }

    const disposition = getExpiredSessionDisposition(session);
    const correlationId = crypto.randomUUID();
    try {
      const results = await env.DB.batch(finalizeLiveSessionStatements(env.DB, {
        sessionId: session.id,
        appointmentId: session.appointment_id,
        facilityId: session.facility_id,
        sessionVersion: session.version,
        sessionStatus: session.status,
        finalSessionStatus: disposition.finalSessionStatus,
        appointmentVersion: session.appointment_version,
        finalAppointmentStatus: disposition.finalAppointmentStatus,
        creditAccountId: session.credit_account_id,
        creditOutcome: disposition.creditOutcome,
        actorUserId: "system:scheduler",
        actorRole: "SYSTEM",
        requestId: correlationId,
        correlationId,
        now,
        reason: disposition.reason,
        event: {
          id: crypto.randomUUID(),
          eventType: disposition.eventType,
          source: "SECUREVISIT_SCHEDULER",
          participantRole: null,
          metadata: { authorizedWindowExpired: true, terminationRequested: disposition.terminationRequested },
        },
      }));
      if (!results[1]?.meta.changes || !results[2]?.meta.changes || !results[4]?.meta.changes) {
        const latest = await env.DB.prepare("SELECT status FROM visit_sessions WHERE id = ? AND facility_id = ?")
          .bind(session.id, session.facility_id).first<{ status: string }>();
        if (latest && !["ENDED", "TERMINATED", "CANCELLED"].includes(latest.status)) {
          operationalLog("error", { event: "EXPIRED_SESSION_FINALIZATION_CONFLICT", sessionId: session.id, facilityId: session.facility_id, actorId: "system:scheduler", correlationId });
        }
      }
    } catch (error) {
      operationalLog("error", { event: "EXPIRED_SESSION_FINALIZATION_FAILED", sessionId: session.id, facilityId: session.facility_id, actorId: "system:scheduler", correlationId, error });
    }
  }
}

function notificationCopy(eventType: string, payload: Record<string, unknown> = {}): { title: string; body: string } {
  if (eventType === "VISITOR_SUSPICIOUS_LOGIN") return { title: "New sign-in detected", body: "A new browser signed in to your SecureVisit account. If this was not you, open Account and sign out all sessions, then contact the facility support team." };
  if (eventType === "LIVE_SESSION_START_FAILED") return { title: "Your visit is temporarily delayed", body: "The facility could not open the secure video room. Your visit has not started or consumed its credit; staff can retry when the video service is available." };
  if (eventType === "LIVE_SESSION_PROVIDER_CLOSE_FAILED") return { title: "Your visit needs facility attention", body: "The video service did not confirm that the visit room closed safely. The facility team has been alerted and will resolve the session before any credit settlement is finalized." };
  if (eventType === "APPOINTMENT_APPROVE") return { title: "Your visit was approved", body: "Your appointment is ready. Open Visit Details to prepare." };
  if (eventType === "APPOINTMENT_REJECT") return { title: "Your visit needs attention", body: "Your appointment request was not approved. Open Visit Details to see the reason." };
  if (eventType === "APPOINTMENT_RESCHEDULED") return { title: "Your visit time changed", body: "Your new time is waiting for facility review. Open Visit Details to see the updated request." };
  if (eventType === "APPOINTMENT_CANCELLED_BY_VISITOR") return { title: "Your visit was cancelled", body: "The appointment was cancelled and any eligible reserved credit is being returned according to facility policy." };
  if (eventType === "VERIFICATION_APPROVED") return { title: "Connection approved", body: "You can now request a visit with this connection." };
  if (eventType === "VERIFICATION_REJECTED") return { title: "Verification needs attention", body: "Your relationship verification needs an update before you can request a visit." };
  if (eventType === "VERIFICATION_MORE_INFO") return { title: "More information is needed", body: "The facility team needs more information for this connection. Open Connections to review the request." };
  if (eventType === "RELATIONSHIP_SUBMITTED") return { title: "Connection request received", body: "Your relationship request is with the facility team for review." };
  if (eventType === "EVIDENCE_UPLOADED") return { title: "Document received", body: "Your supporting document was received and is being checked before review." };
  if (eventType === "APPOINTMENT_SUBMITTED") return { title: "Visit request received", body: "The facility team has your request and will review it shortly." };
  if (eventType === "PAYMENT_CHECKOUT_CREATED") return { title: "Checkout is ready", body: "Complete your payment with the secure payment service. Credits are added after confirmation." };
  if (eventType === "PAYMENT_CHECKOUT_FAILED") return { title: "Checkout could not start", body: "Your payment was not charged. You can try starting checkout again from Visit Credits." };
  if (eventType === "PAYMENT_REFUND_FAILED") return { title: "Refund needs attention", body: "The payment service could not start your refund. The facility team can retry it from Finance." };
  if (eventType === "PAYMENT_REFUND_REQUESTED" || eventType === "PAYMENT_REFUND_PROVIDER_ACCEPTED") return { title: "Refund requested", body: "Your refund request is being processed. We will update your Visit Credit balance when the payment service confirms it." };
  if (eventType === "PAYMENT_STATUS_UPDATED" && payload.status === "REFUNDED") return { title: "Refund completed", body: "Your refund was confirmed and your Visit Credit balance has been updated." };
  if (eventType === "PAYMENT_STATUS_UPDATED" && payload.status === "DISPUTED") return { title: "Payment under review", body: "Your payment is under provider review. The facility team will update you when the review is resolved." };
  if (eventType === "PAYMENT_STATUS_UPDATED" && ["PENDING", "PROCESSING"].includes(String(payload.status || "").toUpperCase())) return { title: "Payment confirmation is pending", body: "Your payment provider has not confirmed the purchase yet. Your Visit Credit balance will update after confirmation." };
  if (eventType === "PAYMENT_STATUS_UPDATED") return { title: "Payment status updated", body: "Your Visit Credit payment status changed. Open Visit Credits to see the confirmed balance or next step." };
  if (eventType === "SESSION_EXPIRED" || eventType === "SESSION_ABANDONED") return { title: "Your visit could not continue", body: "The live visit timed out or lost its connection. Open Visit Details to see the final credit outcome." };
  if (eventType === "SESSION_TERMINATED" || eventType === "VISIT_TERMINATED") return { title: "Visit ended", body: "Your visit ended and the final credit outcome is available in Visit Details." };
  if (eventType.startsWith("WAITING_ROOM_")) return { title: "Your visit is being prepared", body: "The facility team updated your visit readiness. Open Visit Details for the latest next step." };
  if (eventType === "VISIT_COMPLETED") return { title: "Visit completed", body: "Your visit is complete. Open Visit Details to review the outcome and credit receipt." };
  return { title: "SecureVisit update", body: "There is a new update in your SecureVisit account." };
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async scheduled(_event: { scheduledTime: number; cron: string }, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(Promise.all([processOutbox(env), reconcilePaymentEvents(env), expireAbandonedPaymentIntents(env), reconcileWaitingRoomNoShows(env), purgeExpiredEvidence(env), purgeExpiredStepUpAssertions(env), expireBreakGlassRequests(env), purgeExpiredAuthArtifacts(env.DB), purgeStaleRateLimitBuckets(env.DB), reconcileExpiredSessions(env)]));
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const environmentCheck = validateEnvironment(env);
    if (environmentCheck.environment === "invalid" || (!environmentCheck.ok && environmentCheck.environment !== "development")) {
      operationalLog("error", { event: "ENVIRONMENT_VALIDATION_FAILED", requestId: request.headers.get("x-request-id") || crypto.randomUUID(), missing: environmentCheck.missing });
      return Response.json({ error: "SERVICE_NOT_READY" }, { status: 503, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    if (!isSameOriginMutation(request)) {
      const response = Response.json({ error: "CSRF_ORIGIN_INVALID" }, { status: 403, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      return response;
    }

    const response = await handler.fetch(request, env, ctx);
    const securedResponse = new Response(response.body, response);
    securedResponse.headers.set("Content-Security-Policy", `default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'unsafe-inline'; connect-src 'self' ${liveKitConnectSources(env)}`);
    securedResponse.headers.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=()");
    securedResponse.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    securedResponse.headers.set("X-Content-Type-Options", "nosniff");
    securedResponse.headers.set("X-Frame-Options", "DENY");
    securedResponse.headers.set("X-XSS-Protection", "0");
    if (request.method !== "GET" || new URL(request.url).pathname.startsWith("/api/")) securedResponse.headers.set("Cache-Control", "no-store");
    return securedResponse;
  },
};

export default worker;
