import { getD1 } from "../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requireOrganizationPermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requireOrganizationPermission("organization.manage");
    const d1 = await getD1();
    const organization = await d1.prepare(`SELECT o.id, o.name, o.slug, o.address, o.contact_email, o.contact_phone, o.status, o.version, o.created_at, o.updated_at
      FROM organizations o WHERE o.id = ?`).bind(authorization.organizationId).first();
    if (!organization) return securityResponse({ organization: null, facilities: [] }, 200, context.requestId);
    const facilities = await d1.prepare(`SELECT f.id, f.name, f.timezone, f.current_state, f.version, f.created_at, f.updated_at
      FROM facilities f
      WHERE f.organization_id = ? ORDER BY f.name ASC`).bind(organization.id).all();
    return securityResponse({ organization, facilities: facilities.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function PATCH(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requireOrganizationPermission("organization.manage");
    const body = await request.json() as { name?: unknown; slug?: unknown; address?: unknown; contactEmail?: unknown; contactPhone?: unknown; expectedVersion?: unknown; reason?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
    const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase().slice(0, 100) : "";
    const address = typeof body.address === "string" ? body.address.trim().slice(0, 500) : null;
    const contactEmail = typeof body.contactEmail === "string" ? body.contactEmail.trim().toLowerCase().slice(0, 254) : null;
    const contactPhone = typeof body.contactPhone === "string" ? body.contactPhone.trim().slice(0, 40) : null;
    const expectedVersion = Number(body.expectedVersion);
    const reason = assertReason(body.reason);
    if (name.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !Number.isInteger(expectedVersion) || expectedVersion < 1) throw new SecurityError("INVALID_ORGANIZATION_DETAILS", 400);
    if (contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) throw new SecurityError("INVALID_ORGANIZATION_CONTACT", 400);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    d1 = await getD1();
    const current = await d1.prepare("SELECT id, name, slug, address, contact_email, contact_phone, status, version FROM organizations WHERE id = ? AND status = 'ACTIVE'").bind(authorization.organizationId).first<{ id: string; name: string; slug: string; address: string | null; contact_email: string | null; contact_phone: string | null; status: string; version: number }>();
    if (!current) throw new SecurityError("ORGANIZATION_NOT_FOUND", 404);
    if (current.version !== expectedVersion) throw new SecurityError("STALE_ORGANIZATION", 409);
    const duplicate = await d1.prepare("SELECT id FROM organizations WHERE slug = ? AND id <> ?").bind(slug, current.id).first();
    if (duplicate) throw new SecurityError("ORGANIZATION_SLUG_IN_USE", 409);
    const scope = `organization-details:${current.id}`;
    const requestHash = await hashIdempotencyPayload({ name, slug, address, contactEmail, contactPhone, expectedVersion, reason });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    await requireStepUp({ purpose: "organization_update", userId: authorization.userId, targetId: current.id, payload: { name, slug, expectedVersion, reason } });
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const updated = { id: current.id, name, slug, address, contactEmail, contactPhone, status: current.status, version: expectedVersion + 1 };
    const guard = { sql: "EXISTS (SELECT 1 FROM organizations WHERE id = ? AND version = ? AND name = ? AND slug = ?)", values: [current.id, expectedVersion + 1, name, slug] };
    const results = await d1.batch([
      d1.prepare("UPDATE organizations SET name = ?, slug = ?, address = ?, contact_email = ?, contact_phone = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = 'ACTIVE' AND version = ?").bind(name, slug, address, contactEmail, contactPhone, now, current.id, expectedVersion),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Organization Administrator", organizationId: authorization.organizationId, facilityId: authorization.facilityId || null, actionType: "ORGANIZATION_UPDATED", entityType: "organization", entityId: current.id, reason, oldValues: current, newValues: updated, requestId: context.requestId, correlationId, eventType: "ORGANIZATION_UPDATED", payload: { organizationId: current.id, version: expectedVersion + 1 } }, guard),
      completeIdempotencyStatement(d1, { ...idempotency, status: 200, body: { organization: updated, correlationId }, guard }),
    ]);
    if (!results.every((result) => Boolean(result?.meta.changes))) throw new SecurityError("STALE_ORGANIZATION", 409);
    idempotency = null;
    return securityResponse({ organization: updated, correlationId }, 200, context.requestId);
  } catch (error) {
    if (d1 && idempotency) { try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve original error. */ } }
    return securityErrorResponse(error, context.requestId);
  }
}
