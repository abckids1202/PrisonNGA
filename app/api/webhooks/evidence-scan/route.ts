import { getD1 } from "../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../lib/server/events";
import { enforceRateLimit } from "../../../../lib/server/rate-limit";
import { getRequestContext, getRuntimeValue, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { readTextBodyWithinLimit } from "../../../../lib/server/request-body";
import { verifyPaymentWebhookSignature } from "../../../../lib/server/payments/provider";

type ScanCallback = {
  eventId: string;
  provider: string;
  scanReference: string;
  evidenceId?: string;
  sha256?: string;
  verdict: "clean" | "infected" | "failed";
  error?: string;
};

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const secret = await getRuntimeValue("EVIDENCE_SCAN_WEBHOOK_SECRET");
    if (!secret) throw new SecurityError("EVIDENCE_SCAN_WEBHOOK_NOT_CONFIGURED", 503);
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `evidence-scan-webhook:${context.ipAddress || "unknown"}`, limit: 300, windowSeconds: 60 });
    const rawBody = await readTextBodyWithinLimit(request, 64 * 1024);
    const environment = (await getRuntimeValue("SECUREVISIT_ENVIRONMENT")) || "unknown";
    const timestamp = request.headers.get("x-securevisit-timestamp");
    if (environment !== "development" && !timestamp) throw new SecurityError("EVIDENCE_SCAN_TIMESTAMP_REQUIRED", 401);
    if (!await verifyPaymentWebhookSignature(rawBody, request.headers.get("x-securevisit-signature"), secret, timestamp)) throw new SecurityError("EVIDENCE_SCAN_SIGNATURE_INVALID", 401);
    let input: unknown;
    try { input = JSON.parse(rawBody); } catch { throw new SecurityError("EVIDENCE_SCAN_INVALID", 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new SecurityError("EVIDENCE_SCAN_INVALID", 400);
    const body = input as Record<string, unknown>;
    const callback: ScanCallback = {
      eventId: text(body.eventId, 256),
      provider: text(body.provider, 64).toLowerCase(),
      scanReference: text(body.scanReference, 256),
      evidenceId: text(body.evidenceId, 128) || undefined,
      sha256: text(body.sha256, 64).toLowerCase() || undefined,
      verdict: text(body.verdict, 16).toLowerCase() as ScanCallback["verdict"],
      error: text(body.error, 500) || undefined,
    };
    if (!callback.eventId || !callback.provider || !callback.scanReference || !["clean", "infected", "failed"].includes(callback.verdict)) throw new SecurityError("EVIDENCE_SCAN_INVALID", 400);
    if (callback.sha256 && !/^[a-f0-9]{64}$/.test(callback.sha256)) throw new SecurityError("EVIDENCE_SCAN_INVALID", 400);
    const snapshot = JSON.stringify(callback);
    const existingEvent = await d1.prepare("SELECT payload FROM evidence_scan_events WHERE provider = ? AND event_id = ?").bind(callback.provider, callback.eventId).first<{ payload: string }>();
    if (existingEvent) {
      if (existingEvent.payload !== snapshot) throw new SecurityError("EVIDENCE_SCAN_REPLAY_CONFLICT", 409);
      return securityResponse({ accepted: true, idempotent: true, eventId: callback.eventId }, 200, context.requestId);
    }

    const evidence = await d1.prepare(`SELECT ed.id, ed.organization_id, ed.facility_id, ed.storage_key, ed.sha256, ed.status, ed.scan_status
      FROM evidence_documents ed
      INNER JOIN facilities f ON f.id = ed.facility_id AND f.organization_id = ed.organization_id
      INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE'
      WHERE ed.scan_provider = ? AND ed.scan_reference = ?
        AND (? IS NULL OR ed.id = ?)
        AND (? IS NULL OR ed.sha256 = ?)
      ORDER BY ed.created_at DESC LIMIT 1`)
      .bind(callback.provider, callback.scanReference, callback.evidenceId || null, callback.evidenceId || null, callback.sha256 || null, callback.sha256 || null)
      .first<{ id: string; organization_id: string; facility_id: string; storage_key: string; sha256: string; status: string; scan_status: string }>();

    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const nextStatus = callback.verdict === "clean" ? "AVAILABLE" : "QUARANTINED";
    const nextScanStatus = callback.verdict === "clean" ? "CLEAN" : callback.verdict === "infected" ? "INFECTED" : "FAILED";
    const statements: D1PreparedStatement[] = [
      d1.prepare(`INSERT INTO evidence_scan_events (id, event_id, provider, scan_reference, evidence_id, organization_id, facility_id, verdict, payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(eventId, callback.eventId, callback.provider, callback.scanReference, evidence?.id || callback.evidenceId || null, evidence?.organization_id || null, evidence?.facility_id || null, callback.verdict, snapshot, now),
    ];
    if (!evidence) {
      const results = await d1.batch(statements);
      if (!results[0]?.meta.changes) throw new SecurityError("EVIDENCE_SCAN_EVENT_NOT_PERSISTED", 503);
      return securityResponse({ accepted: true, matched: false, eventId: callback.eventId }, 202, context.requestId);
    }
    if (evidence.status !== "QUARANTINED" || evidence.scan_status !== "PENDING") {
      const results = await d1.batch(statements);
      if (!results[0]?.meta.changes) throw new SecurityError("EVIDENCE_SCAN_EVENT_NOT_PERSISTED", 503);
      return securityResponse({ accepted: true, matched: true, idempotent: true, evidenceId: evidence.id }, 200, context.requestId);
    }
    statements.push(d1.prepare(`UPDATE evidence_documents SET status = ?, scan_status = ?, scan_completed_at = ?, scan_error = ?, updated_at = ?
      WHERE id = ? AND status = 'QUARANTINED' AND scan_status = 'PENDING'`).bind(nextStatus, nextScanStatus, now, callback.error || null, now, evidence.id));
    statements.push(...auditAndOutboxStatements(d1, {
      actorUserId: "system:evidence-scanner",
      actorRole: "SYSTEM",
      facilityId: evidence.facility_id,
      actionType: "EVIDENCE_SCAN_COMPLETED",
      entityType: "evidence_document",
      entityId: evidence.id,
      reason: callback.verdict === "clean" ? "Evidence scanner returned a clean verdict." : "Evidence remains quarantined after a non-clean scanner verdict.",
      oldValues: { status: evidence.status, scanStatus: evidence.scan_status },
      newValues: { status: nextStatus, scanStatus: nextScanStatus, provider: callback.provider, scanReference: callback.scanReference },
      requestId: context.requestId,
      correlationId: callback.eventId,
      eventType: "EVIDENCE_SCAN_COMPLETED",
      payload: { evidenceId: evidence.id, verdict: callback.verdict, provider: callback.provider, scanReference: callback.scanReference },
    }, { sql: "EXISTS (SELECT 1 FROM evidence_documents WHERE id = ? AND facility_id = ? AND status = ? AND scan_status = ?)", values: [evidence.id, evidence.facility_id, nextStatus, nextScanStatus] }));
    const results = await d1.batch(statements);
    if (!results.slice(0, 4).every((result) => Boolean(result?.meta.changes))) throw new SecurityError("EVIDENCE_SCAN_STATE_NOT_PERSISTED", 503);
    return securityResponse({ accepted: true, matched: true, evidenceId: evidence.id, status: nextStatus, scanStatus: nextScanStatus, eventId: callback.eventId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
