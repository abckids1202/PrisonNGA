import { getD1 } from "../../../../db/runtime";
import { createIncidentStatements } from "../../../../lib/server/incident-workflow";
import { hashIdempotencyPayload } from "../../../../lib/server/idempotency";
import { enforceRateLimit } from "../../../../lib/server/rate-limit";
import { getRequestContext, getSecuritySalt, hashIdentifier, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

const categories = ["PAYMENT", "VERIFICATION", "DEVICE", "VISIT", "OTHER"] as const;
type SupportCategory = typeof categories[number];

function supportSeverity(category: SupportCategory): "LOW" | "MEDIUM" {
  return category === "DEVICE" || category === "PAYMENT" ? "MEDIUM" : "LOW";
}

export async function GET() {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT i.id, i.title, i.description, i.status, i.severity, i.appointment_id, i.resolution, i.version, i.created_at, i.updated_at, f.name AS facility_name
      FROM incidents i INNER JOIN facilities f ON f.id = i.facility_id
      WHERE i.reporter_user_id = ? AND i.incident_type = 'VISITOR_SUPPORT'
      ORDER BY i.created_at DESC LIMIT 20`).bind(visitor.userId).all();
    return securityResponse({ cases: result.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const body = await request.json() as { category?: unknown; subject?: unknown; message?: unknown; facilityId?: unknown; appointmentId?: unknown };
    const category = typeof body.category === "string" ? body.category.trim().toUpperCase() as SupportCategory : "";
    const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 160) : "";
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
    const requestedFacilityId = typeof body.facilityId === "string" ? body.facilityId.trim() : "";
    const appointmentId = typeof body.appointmentId === "string" ? body.appointmentId.trim() : "";
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!categories.includes(category)) throw new SecurityError("SUPPORT_CATEGORY_INVALID", 400);
    if (subject.length < 4 || message.length < 8) throw new SecurityError("SUPPORT_DETAILS_REQUIRED", 400);
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `visitor-support:${visitor.userId}`, limit: 5, windowSeconds: 60 * 60 });
    const appointment = appointmentId
      ? await d1.prepare("SELECT id, facility_id FROM appointments WHERE id = ? AND visitor_user_id = ?").bind(appointmentId, visitor.userId).first<{ id: string; facility_id: string }>()
      : null;
    if (appointmentId && !appointment) throw new SecurityError("SUPPORT_APPOINTMENT_NOT_FOUND", 404);
    const facilityId = appointment?.facility_id || requestedFacilityId;
    if (!facilityId) throw new SecurityError("SUPPORT_FACILITY_REQUIRED", 400);
    const facility = await d1.prepare("SELECT f.id FROM facilities f INNER JOIN visit_policies vp ON vp.facility_id = f.id WHERE f.id = ?").bind(facilityId).first<{ id: string }>();
    if (!facility) throw new SecurityError("SUPPORT_FACILITY_NOT_FOUND", 404);
    const payload = { category, subject, message, facilityId, appointmentId: appointment?.id || null };
    const salt = await getSecuritySalt();
    const idempotencyKeyHash = await hashIdentifier(`visitor-support:${visitor.userId}:${idempotencyKey}`, salt);
    const requestHash = await hashIdempotencyPayload(payload);
    const existing = await d1.prepare("SELECT id, status, version, request_hash FROM incidents WHERE reporter_user_id = ? AND incident_type = 'VISITOR_SUPPORT' AND idempotency_key = ?").bind(visitor.userId, idempotencyKeyHash).first<{ id: string; status: string; version: number; request_hash: string }>();
    if (existing) {
      if (existing.request_hash !== requestHash) throw new SecurityError("IDEMPOTENCY_KEY_REUSED", 409);
      return securityResponse({ caseId: existing.id, status: existing.status, version: existing.version, idempotent: true }, 200, context.requestId);
    }
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const id = `SUP-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const severity = supportSeverity(category);
    const event = {
      actorUserId: visitor.userId,
      actorRole: "VISITOR",
      facilityId,
      actionType: "VISITOR_SUPPORT_CREATED",
      entityType: "incident",
      entityId: id,
      reason: message,
      newValues: { category, subject, appointmentId: appointment?.id || null, severity },
      requestId: context.requestId,
      correlationId,
      eventType: "VISITOR_SUPPORT_CREATED",
      payload: { caseId: id, category, appointmentId: appointment?.id || null },
    };
    const results = await d1.batch(createIncidentStatements(d1, {
        id,
        facilityId,
        incidentType: "VISITOR_SUPPORT",
        severity,
        title: subject,
        description: `[${category}] ${message}`,
        appointmentId: appointment?.id || null,
        sessionId: null,
        resourceId: null,
        reporterUserId: visitor.userId,
        idempotencyKey: idempotencyKeyHash,
        requestHash,
        now,
        correlationId,
      }, event));
    if (!results.every((result) => Boolean(result?.meta.changes))) throw new SecurityError("SUPPORT_NOT_PERSISTED", 503);
    return securityResponse({ caseId: id, status: "OPEN", version: 1, correlationId }, 201, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
