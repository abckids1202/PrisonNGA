import { getD1 } from "../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";
import { enforceRateLimit } from "../../../../lib/server/rate-limit";
import { assertReason, getRequestContext, requireOrganizationPermission, requirePlatformProvisioning, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

const timezonePattern = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/;

export async function POST(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    d1 = await getD1();
    await enforceRateLimit(d1, { key: `platform-provisioning:${context.ipAddress || "unknown"}`, limit: 10, windowSeconds: 15 * 60 });
    const operator = await requirePlatformProvisioning(request);
    const body = await request.json() as { organizationName?: unknown; organizationSlug?: unknown; facilityName?: unknown; timezone?: unknown; ownerEmail?: unknown; ownerName?: unknown; ownerReference?: unknown };
    const organizationName = typeof body.organizationName === "string" ? body.organizationName.trim().slice(0, 160) : "";
    const organizationSlug = typeof body.organizationSlug === "string" ? body.organizationSlug.trim().toLowerCase().slice(0, 100) : "";
    const facilityName = typeof body.facilityName === "string" ? body.facilityName.trim().slice(0, 160) : "";
    const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";
    const ownerEmail = typeof body.ownerEmail === "string" ? body.ownerEmail.trim().toLowerCase().slice(0, 254) : "";
    const ownerName = typeof body.ownerName === "string" ? body.ownerName.trim().slice(0, 160) : "";
    const ownerReference = typeof body.ownerReference === "string" ? body.ownerReference.trim().slice(0, 40) : "";
    if (organizationName.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organizationSlug) || facilityName.length < 2 || !timezonePattern.test(timezone) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail) || ownerName.length < 2 || ownerReference.length < 2) {
      throw new SecurityError("INVALID_ORGANIZATION_PROVISIONING", 400);
    }
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const scope = "platform-organization-provisioning";
    const requestHash = await hashIdempotencyPayload({ ...body, operatorReference: operator.operatorReference, changeTicket: operator.changeTicket });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    const organizationId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const policyId = crypto.randomUUID();
    const appointmentTypeId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const responseBody = {
      organization: { id: organizationId, name: organizationName, slug: organizationSlug, status: "ACTIVE", version: 1 },
      facility: { id: facilityId, organizationId, name: facilityName, timezone, currentState: "NORMAL_OPERATIONS", version: 1 },
      owner: { id: ownerId, email: ownerEmail, displayName: ownerName, status: "ACTIVE" },
      correlationId,
    };
    const guard = { sql: "EXISTS (SELECT 1 FROM organizations WHERE id = ? AND status = 'ACTIVE')", values: [organizationId] };
    const results = await d1.batch([
      d1.prepare("INSERT INTO organizations (id, name, slug, status, version, created_at, updated_at) VALUES (?, ?, ?, 'ACTIVE', 1, ?, ?)").bind(organizationId, organizationName, organizationSlug, now, now),
      d1.prepare("INSERT INTO facilities (id, organization_id, name, timezone, current_state, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'NORMAL_OPERATIONS', 1, ?, ?)").bind(facilityId, organizationId, facilityName, timezone, now, now),
      d1.prepare("INSERT INTO visit_policies (id, organization_id, facility_id, min_duration_minutes, max_duration_minutes, min_advance_minutes, max_advance_days, daily_start_time, daily_end_time, credit_currency, recording_policy, version, created_at, updated_at) VALUES (?, ?, ?, 15, 30, 60, 30, '08:00', '17:00', 'IDR', 'OFF', 1, ?, ?)").bind(policyId, organizationId, facilityId, now, now),
      d1.prepare("INSERT INTO appointment_types (id, organization_id, facility_id, code, display_name, description, duration_minutes, credit_cost, status, version, created_at, updated_at) VALUES (?, ?, ?, 'FAMILY_VIDEO', 'Family video visit', 'Standard video visitation appointment.', 30, 1, 'ACTIVE', 1, ?, ?)").bind(appointmentTypeId, organizationId, facilityId, now, now),
      d1.prepare("INSERT INTO users (id, external_id, email, display_name, user_type, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'STAFF', 'ACTIVE', 1, ?, ?)").bind(ownerId, `pending:staff:${ownerId}`, ownerEmail, ownerName, now, now),
      d1.prepare("INSERT INTO staff_profiles (user_id, organization_id, facility_id, employee_reference, job_title, department, created_at, updated_at) VALUES (?, ?, ?, ?, 'Organization Owner', 'Administration', ?, ?)").bind(ownerId, organizationId, facilityId, ownerReference, now, now),
      d1.prepare("INSERT INTO staff_facility_assignments (user_id, organization_id, facility_id, employee_reference, job_title, department, status, assigned_by, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'Organization Owner', 'Administration', 'ACTIVE', NULL, 1, ?, ?)").bind(ownerId, organizationId, facilityId, ownerReference, now, now),
      d1.prepare("INSERT INTO user_roles (user_id, role_id, organization_id, facility_id, assigned_by, assigned_at) VALUES (?, 'role-supervisor', ?, ?, NULL, ?)").bind(ownerId, organizationId, facilityId, now),
      d1.prepare("INSERT INTO organization_role_assignments (user_id, organization_id, role_id, status, assigned_by, version, assigned_at, created_at, updated_at) VALUES (?, ?, 'role-organization-owner', 'ACTIVE', NULL, 1, ?, ?, ?)").bind(ownerId, organizationId, now, now, now),
      d1.prepare("INSERT INTO organization_memberships (id, organization_id, user_id, facility_id, role, status, version, assigned_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'Supervisor', 'ACTIVE', 1, NULL, ?, ?)").bind(membershipId, organizationId, ownerId, facilityId, now, now),
      ...auditAndOutboxStatements(d1, { actorUserId: null, actorRole: `Provisioning Operator:${operator.operatorReference}`, organizationId, facilityId, actionType: "ORGANIZATION_PROVISIONED", entityType: "organization", entityId: organizationId, reason: `Provisioned under change ticket ${operator.changeTicket}.`, newValues: { organizationId, facilityId, ownerId, appointmentType: "FAMILY_VIDEO" }, requestId: `organization-provisioning:${operator.changeTicket}`, correlationId, eventType: "ORGANIZATION_PROVISIONED", payload: { organizationId, facilityId, ownerId, changeTicket: operator.changeTicket } }, guard),
      completeIdempotencyStatement(d1, { ...idempotency, status: 201, body: responseBody, guard }),
    ]);
    if (!results.slice(0, 10).every((result) => Boolean(result?.meta.changes)) || !results.slice(10).every((result) => Boolean(result?.meta.changes))) throw new SecurityError("ORGANIZATION_PROVISIONING_FAILED", 409);
    idempotency = null;
    return securityResponse(responseBody, 201, context.requestId);
  } catch (error) {
    if (d1 && idempotency) { try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve original error. */ } }
    return securityErrorResponse(error, context.requestId);
  }
}

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
