/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  EVIDENCE_BUCKET?: R2Bucket;
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
        await env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, facility_id, user_id, channel, template, title, body, payload, status, attempt_count, available_at, idempotency_key, created_at)
          VALUES (?, ?, ?, 'IN_APP', ?, ?, ?, ?, 'DELIVERED', 1, ?, ?, ?)`).bind(crypto.randomUUID(), row.facility_id, visitorUserId, row.event_type, copy.title, copy.body, JSON.stringify({ aggregateId: row.aggregate_id, correlationId: row.correlation_id, ...payload }), now, `${row.id}:visitor:in-app`, now).run();
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
    ctx.waitUntil(Promise.all([processOutbox(env), purgeExpiredEvidence(env)]));
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

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
