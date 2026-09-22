/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { validateEnvironment } from "../lib/server/config";
import { finalizeLiveSessionStatements, getExpiredSessionDisposition } from "../lib/server/live-session-finalization";
import { createLiveKitProvider } from "../lib/server/video/provider";
import { deliverNotification, getNotificationDelivery } from "../lib/server/notifications/provider";

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

type OutboxRow = { id: string; event_type: string; aggregate_type: string; aggregate_id: string | null; facility_id: string | null; payload: string; correlation_id: string; attempt_count: number };
type ExpiredSession = { id: string; appointment_id: string; facility_id: string; version: number; appointment_version: number; status: string; actual_started_at: string | null; termination_reason: string | null; provider_room_name: string; credit_account_id: string | null };

async function processOutbox(env: Env): Promise<void> {
  await env.DB.prepare("UPDATE outbox_events SET status = 'FAILED', available_at = CURRENT_TIMESTAMP, last_error = 'Recovered stale processing claim.' WHERE status = 'PROCESSING' AND created_at < datetime('now', '-5 minutes')").run();
  const result = await env.DB.prepare("SELECT id, event_type, aggregate_type, aggregate_id, facility_id, payload, correlation_id, attempt_count FROM outbox_events WHERE status IN ('PENDING', 'FAILED') AND available_at <= CURRENT_TIMESTAMP ORDER BY created_at ASC LIMIT 25").all<OutboxRow>();
  for (const row of result.results) {
    const now = new Date().toISOString();
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      const claim = await env.DB.prepare("UPDATE outbox_events SET status = 'PROCESSING', attempt_count = attempt_count + 1, last_error = NULL WHERE id = ? AND status IN ('PENDING', 'FAILED') AND available_at <= CURRENT_TIMESTAMP").bind(row.id).run();
      if (!claim.meta.changes) continue;
      const visitorUserId = typeof payload.visitorUserId === "string" ? payload.visitorUserId : null;
      if (visitorUserId) {
        const copy = notificationCopy(row.event_type);
        const notificationPayload = { aggregateId: row.aggregate_id, correlationId: row.correlation_id, ...payload };
        if (await getNotificationDelivery() === "webhook") {
          const visitor = await env.DB.prepare("SELECT email FROM users WHERE id = ? AND user_type = 'VISITOR' AND status = 'ACTIVE'").bind(visitorUserId).first<{ email: string }>();
          if (!visitor) throw new Error("NOTIFICATION_RECIPIENT_NOT_FOUND");
          await deliverNotification({ notificationId: row.id, email: visitor.email, template: row.event_type, title: copy.title, body: copy.body, payload: notificationPayload });
          await env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, facility_id, user_id, channel, template, title, body, payload, status, attempt_count, available_at, delivered_at, idempotency_key, created_at)
            VALUES (?, ?, ?, 'EMAIL', ?, ?, ?, ?, 'DELIVERED', 1, ?, ?, ?, ?)`).bind(`${row.id}:email`, row.facility_id, visitorUserId, row.event_type, copy.title, copy.body, JSON.stringify(notificationPayload), now, now, `${row.id}:visitor:email`, now).run();
        }
        await env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, facility_id, user_id, channel, template, title, body, payload, status, attempt_count, available_at, delivered_at, idempotency_key, created_at)
          VALUES (?, ?, ?, 'IN_APP', ?, ?, ?, ?, 'DELIVERED', 1, ?, ?, ?, ?)`).bind(`${row.id}:in-app`, row.facility_id, visitorUserId, row.event_type, copy.title, copy.body, JSON.stringify(notificationPayload), now, now, `${row.id}:visitor:in-app`, now).run();
      }
      await env.DB.prepare("UPDATE outbox_events SET status = 'PROCESSED', processed_at = ? WHERE id = ? AND status = 'PROCESSING'").bind(now, row.id).run();
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "OUTBOX_PROCESSING_FAILED";
      const attempt = row.attempt_count + 1;
      const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, attempt - 1)));
      const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      await env.DB.prepare("UPDATE outbox_events SET status = CASE WHEN attempt_count >= 5 THEN 'DEAD_LETTER' ELSE 'FAILED' END, available_at = ?, last_error = ? WHERE id = ? AND status = 'PROCESSING'").bind(nextAttemptAt, message, row.id).run();
    }
  }
}

async function purgeExpiredEvidence(env: Env): Promise<void> {
  if (!env.EVIDENCE_BUCKET) return;
  const rows = await env.DB.prepare("SELECT id, storage_key FROM evidence_documents WHERE status = 'AVAILABLE' AND legal_hold = 0 AND retention_until <= CURRENT_TIMESTAMP LIMIT 50").all<{ id: string; storage_key: string }>();
  for (const row of rows.results) {
    await env.EVIDENCE_BUCKET.delete(row.storage_key);
    await env.DB.prepare("UPDATE evidence_documents SET status = 'DELETED', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'AVAILABLE' AND legal_hold = 0").bind(row.id).run();
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
    console.error(JSON.stringify({ event: "EXPIRED_SESSION_PROVIDER_UNAVAILABLE", error: error instanceof Error ? error.message : "UNKNOWN" }));
    return;
  }

  for (const session of sessions.results) {
    const now = new Date().toISOString();
    try {
      await provider.endRoom(session.provider_room_name);
    } catch (error) {
      console.error(JSON.stringify({ event: "EXPIRED_SESSION_ROOM_CLOSE_FAILED", sessionId: session.id, facilityId: session.facility_id, error: error instanceof Error ? error.message : "UNKNOWN" }));
      continue;
    }
    if (!session.credit_account_id) {
      console.error(JSON.stringify({ event: "EXPIRED_SESSION_CREDIT_ACCOUNT_MISSING", sessionId: session.id, appointmentId: session.appointment_id, facilityId: session.facility_id }));
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
          console.error(JSON.stringify({ event: "EXPIRED_SESSION_FINALIZATION_CONFLICT", sessionId: session.id, facilityId: session.facility_id }));
        }
      }
    } catch (error) {
      console.error(JSON.stringify({ event: "EXPIRED_SESSION_FINALIZATION_FAILED", sessionId: session.id, facilityId: session.facility_id, error: error instanceof Error ? error.message : "UNKNOWN" }));
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
    ctx.waitUntil(Promise.all([processOutbox(env), purgeExpiredEvidence(env), purgeExpiredStepUpAssertions(env), reconcileExpiredSessions(env)]));
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const environmentCheck = validateEnvironment(env);
    if (environmentCheck.environment === "invalid" || (!environmentCheck.ok && environmentCheck.environment !== "development")) {
      console.error(JSON.stringify({ event: "ENVIRONMENT_VALIDATION_FAILED", missing: environmentCheck.missing, requestId: request.headers.get("x-request-id") || crypto.randomUUID() }));
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

    const response = await handler.fetch(request, env, ctx);
    const securedResponse = new Response(response.body, response);
    securedResponse.headers.set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.livekit.cloud wss://*.livekit.cloud https://*.livekit.io wss://*.livekit.io");
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
