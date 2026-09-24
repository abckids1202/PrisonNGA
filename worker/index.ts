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
import { expiredEvidenceRetentionStatements } from "../lib/server/retention-workflow";
import { operationalLog } from "../lib/server/observability";

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
type ExpiredSession = { id: string; appointment_id: string; facility_id: string; version: number; appointment_version: number; status: string; actual_started_at: string | null; termination_reason: string | null; provider_room_name: string; credit_account_id: string | null };
type PaymentRetryEvent = { id: string; provider: string; event_key: string; event_type: string; payload: string; attempt_count: number };

async function reconcileWaitingRoomNoShows(env: Env): Promise<void> {
  const rows = await env.DB.prepare(`SELECT a.id, a.facility_id, a.visitor_user_id, a.status, a.version, a.requested_end,
      ca.id AS credit_account_id
    FROM appointments a
    LEFT JOIN waiting_room_sessions w ON w.appointment_id = a.id AND w.facility_id = a.facility_id
    LEFT JOIN visit_sessions vs ON vs.appointment_id = a.id AND vs.facility_id = a.facility_id
      AND vs.status IN ('CONNECTING', 'ACTIVE', 'RECONNECTING', 'ENDING')
    LEFT JOIN credit_accounts ca ON ca.user_id = a.visitor_user_id AND ca.facility_id = a.facility_id
    WHERE a.status IN ('APPROVED', 'WAITING')
      AND a.requested_end <= CURRENT_TIMESTAMP
      AND vs.id IS NULL
      AND COALESCE(w.visitor_presence, 'absent') <> 'present'
      AND COALESCE(w.prisoner_presence, 'waiting') <> 'present'
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
    SET status = 'FAILED', available_at = CURRENT_TIMESTAMP, last_error = 'Recovered stale processing claim.'
    WHERE status = 'PROCESSING' AND created_at < datetime('now', '-5 minutes')`).run();
  const rows = await env.DB.prepare("SELECT id, provider, event_key, event_type, payload, attempt_count FROM payment_provider_events WHERE status IN ('RECEIVED', 'FAILED') AND available_at <= CURRENT_TIMESTAMP ORDER BY created_at ASC LIMIT 25").all<PaymentRetryEvent>();
  for (const row of rows.results) {
    const claim = await env.DB.prepare("UPDATE payment_provider_events SET status = 'PROCESSING', attempt_count = attempt_count + 1, last_error = NULL WHERE id = ? AND status IN ('RECEIVED', 'FAILED') AND available_at <= CURRENT_TIMESTAMP").bind(row.id).run();
    if (!claim.meta.changes) continue;
    try {
      const payload = JSON.parse(row.payload) as { eventType?: unknown; paymentIntentId?: unknown; providerReference?: unknown; status?: unknown };
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
        },
      });
    } catch (error) {
      const attempt = row.attempt_count + 1;
      const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, attempt - 1)));
      const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      const message = error instanceof Error ? error.message.slice(0, 500) : "PAYMENT_EVENT_RECONCILIATION_FAILED";
      await env.DB.prepare("UPDATE payment_provider_events SET status = CASE WHEN attempt_count >= 8 THEN 'DEAD_LETTER' ELSE 'FAILED' END, available_at = ?, last_error = ? WHERE id = ? AND status = 'PROCESSING'").bind(nextAttemptAt, message, row.id).run();
      operationalLog("error", { event: "PAYMENT_EVENT_RECONCILIATION_FAILED", eventId: row.id, provider: row.provider, attempt, correlationId: row.event_key, error: message });
    }
  }
}

async function processOutbox(env: Env): Promise<void> {
  await env.DB.prepare("UPDATE outbox_events SET status = 'FAILED', available_at = CURRENT_TIMESTAMP, last_error = 'Recovered stale processing claim.' WHERE status = 'PROCESSING' AND created_at < datetime('now', '-5 minutes')").run();
  await env.DB.prepare(`UPDATE notification_delivery_attempts
    SET status = 'FAILED', error_message = 'Recovered stale outbox claim.', finished_at = CURRENT_TIMESTAMP
    WHERE status = 'PROCESSING'
      AND EXISTS (
        SELECT 1 FROM outbox_events
        WHERE outbox_events.id = notification_delivery_attempts.outbox_event_id
          AND outbox_events.status = 'FAILED'
          AND outbox_events.last_error = 'Recovered stale processing claim.'
      )`).run();
  const result = await env.DB.prepare("SELECT id, event_type, aggregate_type, aggregate_id, facility_id, payload, correlation_id, attempt_count FROM outbox_events WHERE status IN ('PENDING', 'FAILED') AND available_at <= CURRENT_TIMESTAMP ORDER BY created_at ASC LIMIT 25").all<OutboxRow>();
  for (const row of result.results) {
    const now = new Date().toISOString();
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      const claim = await env.DB.prepare("UPDATE outbox_events SET status = 'PROCESSING', attempt_count = attempt_count + 1, last_error = NULL WHERE id = ? AND status IN ('PENDING', 'FAILED') AND available_at <= CURRENT_TIMESTAMP").bind(row.id).run();
      if (!claim.meta.changes) continue;
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
        const copy = notificationCopy(row.event_type);
        const notificationPayload = { aggregateId: row.aggregate_id, correlationId: row.correlation_id, ...payload };
        const notificationDelivery = await getNotificationDelivery();
        if (notificationDelivery === "webhook") {
          const visitor = await env.DB.prepare("SELECT email, phone FROM users WHERE id = ? AND user_type = 'VISITOR' AND status = 'ACTIVE'").bind(visitorUserId).first<{ email: string | null; phone: string | null }>();
          if (!visitor) throw new Error("NOTIFICATION_RECIPIENT_NOT_FOUND");
          const channel = visitor.email ? "EMAIL" : visitor.phone ? "SMS" : null;
          if (!channel) throw new Error("NOTIFICATION_RECIPIENT_NOT_FOUND");
          const externalNotificationKey = `${row.id}:visitor:${channel.toLowerCase()}`;
          const alreadyDelivered = await env.DB.prepare("SELECT id FROM notifications WHERE idempotency_key = ? AND status = 'DELIVERED' LIMIT 1").bind(externalNotificationKey).first<{ id: string }>();
          if (!alreadyDelivered) {
            await deliverNotification({ notificationId: row.id, email: visitor.email, phone: visitor.phone, template: row.event_type, title: copy.title, body: copy.body, payload: notificationPayload });
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
      await env.DB.prepare("UPDATE outbox_events SET status = 'PROCESSED', processed_at = ? WHERE id = ? AND status = 'PROCESSING'").bind(now, row.id).run();
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "OUTBOX_PROCESSING_FAILED";
      const attempt = row.attempt_count + 1;
      const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, attempt - 1)));
      const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      await env.DB.prepare("UPDATE notification_delivery_attempts SET status = 'FAILED', error_message = ?, finished_at = ? WHERE outbox_event_id = ? AND attempt_number = ? AND status = 'PROCESSING'").bind(message, now, row.id, attempt).run();
      await env.DB.prepare("UPDATE outbox_events SET status = CASE WHEN attempt_count >= 5 THEN 'DEAD_LETTER' ELSE 'FAILED' END, available_at = ?, last_error = ? WHERE id = ? AND status = 'PROCESSING'").bind(nextAttemptAt, message, row.id).run();
      operationalLog("error", { event: attempt >= 5 ? "NOTIFICATION_OUTBOX_DEAD_LETTER" : "NOTIFICATION_OUTBOX_RETRY_SCHEDULED", outboxEventId: row.id, eventType: row.event_type, facilityId: row.facility_id, correlationId: row.correlation_id, attempt, error: message });
    }
  }
}

async function purgeExpiredEvidence(env: Env): Promise<void> {
  if (!env.EVIDENCE_BUCKET) return;
  const rows = await env.DB.prepare("SELECT id, facility_id, storage_key, retention_until FROM evidence_documents WHERE status = 'AVAILABLE' AND legal_hold = 0 AND retention_until <= CURRENT_TIMESTAMP LIMIT 50").all<{ id: string; facility_id: string; storage_key: string; retention_until: string }>();
  for (const row of rows.results) {
    const correlationId = crypto.randomUUID();
    try {
      await env.EVIDENCE_BUCKET.delete(row.storage_key);
      const now = new Date().toISOString();
      await env.DB.batch(expiredEvidenceRetentionStatements(env.DB, {
        id: row.id,
        facilityId: row.facility_id,
        storageKey: row.storage_key,
        retentionUntil: row.retention_until,
        requestId: correlationId,
        correlationId,
        now,
      }));
    } catch (error) {
      operationalLog("error", { event: "EVIDENCE_RETENTION_DELETE_FAILED", evidenceId: row.id, facilityId: row.facility_id, requestId: correlationId, correlationId, error });
    }
  }
}

async function purgeExpiredStepUpAssertions(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM step_up_assertions WHERE julianday(expires_at) <= julianday('now')").run();
}

async function reconcileExpiredSessions(env: Env): Promise<void> {
  const sessions = await env.DB.prepare(`SELECT vs.id, vs.appointment_id, vs.facility_id, vs.version, vs.status, vs.actual_started_at,
      vs.termination_reason, vs.provider_room_name, a.version AS appointment_version, ca.id AS credit_account_id
    FROM visit_sessions vs INNER JOIN appointments a ON a.id = vs.appointment_id AND a.facility_id = vs.facility_id
    LEFT JOIN credit_accounts ca ON ca.user_id = a.visitor_user_id AND ca.facility_id = a.facility_id
    WHERE a.status = 'IN_PROGRESS' AND (
      (vs.status = 'ENDING' AND vs.updated_at <= datetime('now', '-1 minute'))
      OR (vs.status IN ('CONNECTING', 'ACTIVE', 'RECONNECTING') AND vs.authorized_end_at <= CURRENT_TIMESTAMP)
    ) LIMIT 25`).all<ExpiredSession>();
  if (!sessions.results.length) return;

  let provider: Awaited<ReturnType<typeof createLiveKitProvider>>;
  try {
    provider = await createLiveKitProvider();
  } catch (error) {
    operationalLog("error", { event: "EXPIRED_SESSION_PROVIDER_UNAVAILABLE", actorId: "system:scheduler", error });
    return;
  }

  for (const session of sessions.results) {
    const now = new Date().toISOString();
    try {
      await provider.endRoom(session.provider_room_name);
    } catch (error) {
      operationalLog("error", { event: "EXPIRED_SESSION_ROOM_CLOSE_FAILED", sessionId: session.id, facilityId: session.facility_id, actorId: "system:scheduler", error });
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

function notificationCopy(eventType: string): { title: string; body: string } {
  if (eventType === "APPOINTMENT_APPROVE") return { title: "Your visit was approved", body: "Your appointment is ready. Open Visit Details to prepare." };
  if (eventType === "APPOINTMENT_REJECT") return { title: "Your visit needs attention", body: "Your appointment request was not approved. Open Visit Details to see the reason." };
  if (eventType === "VERIFICATION_APPROVED") return { title: "Connection approved", body: "You can now request a visit with this connection." };
  if (eventType === "VERIFICATION_REJECTED") return { title: "Verification needs attention", body: "Your relationship verification needs an update before you can request a visit." };
  if (eventType === "APPOINTMENT_SUBMITTED") return { title: "Visit request received", body: "The facility team has your request and will review it shortly." };
  return { title: "SecureVisit update", body: "There is a new update in your SecureVisit account." };
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async scheduled(_event: { scheduledTime: number; cron: string }, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(Promise.all([processOutbox(env), reconcilePaymentEvents(env), reconcileWaitingRoomNoShows(env), purgeExpiredEvidence(env), purgeExpiredStepUpAssertions(env), purgeExpiredAuthArtifacts(env.DB), reconcileExpiredSessions(env)]));
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
