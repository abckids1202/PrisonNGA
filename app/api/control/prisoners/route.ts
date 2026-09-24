import { getD1 } from "../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

const prisonerStatuses = ["ACTIVE", "TRANSFERRED", "RELEASED", "INACTIVE"] as const;
const visitationStatuses = ["APPROVED", "RESTRICTED", "SUSPENDED"] as const;
type PrisonerStatus = typeof prisonerStatuses[number];
type VisitationStatus = typeof visitationStatuses[number];

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validateRecord(body: Record<string, unknown>) {
  const prisonerNumber = text(body.prisonerNumber, 40).toUpperCase();
  const displayName = text(body.displayName, 160);
  const housingUnit = text(body.housingUnit, 80) || null;
  const status = prisonerStatuses.includes(body.status as PrisonerStatus) ? body.status as PrisonerStatus : "";
  const visitationStatus = visitationStatuses.includes(body.visitationStatus as VisitationStatus) ? body.visitationStatus as VisitationStatus : "";
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,39}$/.test(prisonerNumber) || displayName.length < 2 || !status || !visitationStatus) {
    throw new SecurityError("INVALID_PRISONER_RECORD", 400);
  }
  if (status !== "ACTIVE" && visitationStatus === "APPROVED") throw new SecurityError("INACTIVE_PRISONER_CANNOT_BE_VISIT_APPROVED", 400);
  return { prisonerNumber, displayName, housingUnit, status, visitationStatus };
}

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.read");
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT p.id, p.prisoner_number, p.display_name, p.housing_unit, p.status,
        p.visitation_status, p.version, p.created_at, p.updated_at,
        (SELECT COUNT(*) FROM visitor_relationships vr WHERE vr.facility_id = p.facility_id AND vr.prisoner_id = p.id AND vr.status = 'APPROVED') AS approved_visitor_count,
        (SELECT COUNT(*) FROM appointments a WHERE a.facility_id = p.facility_id AND a.prisoner_id = p.id
          AND a.status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'WAITING', 'IN_PROGRESS')) AS active_visit_count,
        (SELECT MIN(a.requested_start) FROM appointments a WHERE a.facility_id = p.facility_id AND a.prisoner_id = p.id
          AND a.status IN ('APPROVED', 'WAITING') AND a.requested_start >= ?) AS next_visit_at
      FROM prisoners p WHERE p.facility_id = ? ORDER BY p.display_name LIMIT 250`)
      .bind(new Date().toISOString(), authorization.facilityId).all();
    return securityResponse({ prisoners: result.results, facilityId: authorization.facilityId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("prisoner.manage");
    const body = await request.json() as Record<string, unknown>;
    const prisoner = validateRecord(body);
    const reason = assertReason(body.reason);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    d1 = await getD1();
    const idempotencyScope = `prisoner-create:${authorization.facilityId}:${authorization.userId}`;
    const requestHash = await hashIdempotencyPayload({ prisoner, reason });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope: idempotencyScope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope: idempotencyScope, key: idempotencyKey };
    const duplicate = await d1.prepare("SELECT id FROM prisoners WHERE facility_id = ? AND prisoner_number = ?")
      .bind(authorization.facilityId, prisoner.prisonerNumber).first();
    if (duplicate) throw new SecurityError("PRISONER_NUMBER_ALREADY_EXISTS", 409);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const responseBody = { prisoner: { id, facilityId: authorization.facilityId, ...prisoner, version: 1, createdAt: now, updatedAt: now }, correlationId };
    const statements = await d1.batch([
      d1.prepare(`INSERT INTO prisoners (id, facility_id, prisoner_number, display_name, housing_unit, status, visitation_status, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .bind(id, authorization.facilityId, prisoner.prisonerNumber, prisoner.displayName, prisoner.housingUnit, prisoner.status, prisoner.visitationStatus, now, now),
      ...auditAndOutboxStatements(d1, {
        actorUserId: authorization.userId,
        actorRole: authorization.roles[0] || null,
        facilityId: authorization.facilityId,
        actionType: "PRISONER_CREATED",
        entityType: "prisoner",
        entityId: id,
        reason,
        newValues: { ...prisoner, version: 1 },
        requestId: context.requestId,
        correlationId,
        eventType: "PRISONER_CREATED",
        payload: { prisonerId: id, status: prisoner.status, visitationStatus: prisoner.visitationStatus },
      }, { sql: "changes() > 0", values: [] }),
      completeIdempotencyStatement(d1, { ...idempotency, status: 201, body: responseBody, guard: { sql: "EXISTS (SELECT 1 FROM prisoners WHERE id = ? AND facility_id = ? AND version = 1)", values: [id, authorization.facilityId] } }),
    ]);
    if (!statements[0]?.meta.changes || !statements[statements.length - 1]?.meta.changes) throw new SecurityError("PRISONER_CREATE_FAILED", 409);
    return securityResponse(responseBody, 201, context.requestId);
  } catch (error) {
    if (d1 && idempotency) {
      try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve the original prisoner creation error. */ }
    }
    return securityErrorResponse(error, context.requestId);
  }
}

export async function PATCH(request: Request) {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("prisoner.manage");
    const body = await request.json() as Record<string, unknown>;
    const id = text(body.id, 80);
    const expectedVersion = body.expectedVersion;
    if (!id || !Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) throw new SecurityError("PRISONER_VERSION_REQUIRED", 400);
    const prisoner = validateRecord(body);
    const reason = assertReason(body.reason);
    const d1 = await getD1();
    const current = await d1.prepare(`SELECT id, prisoner_number, display_name, housing_unit, status, visitation_status, version
      FROM prisoners WHERE id = ? AND facility_id = ?`).bind(id, authorization.facilityId)
      .first<{ id: string; prisoner_number: string; display_name: string; housing_unit: string | null; status: string; visitation_status: string; version: number }>();
    if (!current) throw new SecurityError("PRISONER_NOT_FOUND", 404);
    if (current.version !== expectedVersion) throw new SecurityError("STALE_PRISONER_RECORD", 409);
    const nextVersion = current.version + 1;
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const statements = await d1.batch([
      d1.prepare(`UPDATE prisoners SET prisoner_number = ?, display_name = ?, housing_unit = ?, status = ?, visitation_status = ?,
        version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND version = ?`)
        .bind(prisoner.prisonerNumber, prisoner.displayName, prisoner.housingUnit, prisoner.status, prisoner.visitationStatus, now, id, authorization.facilityId, current.version),
      ...auditAndOutboxStatements(d1, {
        actorUserId: authorization.userId,
        actorRole: authorization.roles[0] || null,
        facilityId: authorization.facilityId,
        actionType: "PRISONER_UPDATED",
        entityType: "prisoner",
        entityId: id,
        reason,
        oldValues: { prisonerNumber: current.prisoner_number, displayName: current.display_name, housingUnit: current.housing_unit, status: current.status, visitationStatus: current.visitation_status, version: current.version },
        newValues: { ...prisoner, version: nextVersion },
        requestId: context.requestId,
        correlationId,
        eventType: "PRISONER_UPDATED",
        payload: { prisonerId: id, status: prisoner.status, visitationStatus: prisoner.visitationStatus, version: nextVersion },
      }, { sql: "changes() > 0", values: [] }),
    ]);
    if (!statements[0]?.meta.changes) throw new SecurityError("STALE_PRISONER_RECORD", 409);
    return securityResponse({ prisoner: { id, facilityId: authorization.facilityId, ...prisoner, version: nextVersion, updatedAt: now }, correlationId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
