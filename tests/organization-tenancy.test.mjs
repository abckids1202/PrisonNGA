import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("organization administration uses a dedicated organization-role boundary", async () => {
  const security = await readFile(new URL("../lib/server/security.ts", import.meta.url), "utf8");
  const organizations = await readFile(new URL("../app/api/control/organizations/route.ts", import.meta.url), "utf8");
  const facilities = await readFile(new URL("../app/api/control/facilities/route.ts", import.meta.url), "utf8");
  const memberships = await readFile(new URL("../app/api/control/memberships/route.ts", import.meta.url), "utf8");
  const staff = await readFile(new URL("../app/api/control/staff/route.ts", import.meta.url), "utf8");
  const organizationRoles = await readFile(new URL("../app/api/control/organization-roles/route.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0061_organization_role_assignments.sql", import.meta.url), "utf8");
  const contactMigration = await readFile(new URL("../drizzle/0063_organization_contact_details.sql", import.meta.url), "utf8");
  const facilityContactMigration = await readFile(new URL("../drizzle/0064_facility_contact_details.sql", import.meta.url), "utf8");
  const roleSeparationMigration = await readFile(new URL("../drizzle/0067_separate_organization_roles.sql", import.meta.url), "utf8");

  assert.match(security, /export async function requireOrganizationPermission/);
  assert.match(security, /organization_role_assignments/);
  assert.match(memberships, /organization\.manage/);
  assert.match(staff, /role-organization-owner/);
  assert.match(organizations, /requireOrganizationPermission\("organization\.manage"\)/);
  assert.match(facilities, /requireOrganizationPermission\("organization\.manage"\)/);
  assert.match(memberships, /requireOrganizationPermission\("organization\.manage"\)/);
  assert.match(organizationRoles, /export async function POST/);
  assert.match(organizationRoles, /ORGANIZATION_ROLE_ASSIGNED/);
  assert.match(organizationRoles, /ORGANIZATION_ROLE_REVOKED/);
  assert.match(organizationRoles, /requireStepUp/);
  assert.match(organizations, /export async function PATCH/);
  assert.match(organizations, /export async function POST/);
  assert.match(organizations, /requirePlatformProvisioning/);
  assert.match(organizations, /platform-provisioning:/);
  assert.match(organizations, /enforceRateLimit/);
  assert.match(organizations, /readTextBodyWithinLimit\(request, 32 \* 1024\)/);
  assert.match(organizations, /INVALID_ORGANIZATION_PROVISIONING/);
  assert.match(organizations, /ORGANIZATION_PROVISIONED/);
  assert.match(organizations, /ORGANIZATION_UPDATED/);
  assert.match(organizations, /STALE_ORGANIZATION/);
  assert.match(migration, /CREATE TABLE `organization_role_assignments`/);
  assert.match(migration, /p\.permission_key = 'organization\.manage'/);
  assert.match(contactMigration, /ALTER TABLE `organizations` ADD COLUMN `address`/);
  assert.match(contactMigration, /contact_email/);
  assert.match(contactMigration, /contact_phone/);
  assert.match(facilityContactMigration, /ALTER TABLE `facilities` ADD COLUMN `address`/);
  assert.match(facilityContactMigration, /contact_email/);
  assert.match(facilityContactMigration, /contact_phone/);
  assert.match(roleSeparationMigration, /role_id = 'role-supervisor'/);
  assert.match(roleSeparationMigration, /status = 'REVOKED'/);
});

test("organization bootstrap is not available through the ordinary organization-admin session", async () => {
  const source = await readFile(new URL("../app/api/control/organizations/route.ts", import.meta.url), "utf8");
  const postHandler = source.slice(source.indexOf("export async function POST"), source.indexOf("export async function GET"));
  assert.match(postHandler, /requirePlatformProvisioning\(request\)/);
  assert.doesNotMatch(postHandler, /requireOrganizationPermission\("organization\.manage"\)/);
});

test("organization administration does not enumerate facilities through visitor memberships", async () => {
  const source = await readFile(new URL("../app/api/control/organizations/route.ts", import.meta.url), "utf8");
  const readHandler = source.slice(source.indexOf("export async function GET"), source.indexOf("export async function PATCH"));
  assert.doesNotMatch(readHandler, /organization_memberships/);
  assert.match(readHandler, /WHERE f\.organization_id = \?/);
});

test("last staff membership revocation invalidates the target's active sessions", async () => {
  const source = await readFile(new URL("../app/api/control/memberships/route.ts", import.meta.url), "utf8");
  assert.match(source, /UPDATE auth_sessions SET revoked_at/);
  assert.match(source, /NOT EXISTS \(SELECT 1 FROM organization_memberships WHERE user_id = \? AND status = 'ACTIVE'\)/);
  assert.match(source, /NOT EXISTS \(SELECT 1 FROM organization_role_assignments WHERE user_id = \? AND status = 'ACTIVE'\)/);
});

test("last organization role revocation invalidates the target's active sessions", async () => {
  const source = await readFile(new URL("../app/api/control/organization-roles/route.ts", import.meta.url), "utf8");
  assert.match(source, /UPDATE auth_sessions SET revoked_at/);
  assert.match(source, /NOT EXISTS \(SELECT 1 FROM organization_memberships WHERE user_id = \? AND status = 'ACTIVE'\)/);
  assert.match(source, /NOT EXISTS \(SELECT 1 FROM organization_role_assignments WHERE user_id = \? AND status = 'ACTIVE'\)/);
});

test("legacy staff profiles cannot bypass modern assignment revocation", async () => {
  const security = await readFile(new URL("../lib/server/security.ts", import.meta.url), "utf8");
  const context = await readFile(new URL("../app/api/auth/facility-context/route.ts", import.meta.url), "utf8");
  assert.match(security, /NOT EXISTS \(SELECT 1 FROM staff_facility_assignments WHERE user_id = \?\)/);
  assert.match(context, /NOT EXISTS \(SELECT 1 FROM staff_facility_assignments sfa2 WHERE sfa2\.user_id = \?\)/);
});

test("staff facility authorization fails closed when the organization is disabled", async () => {
  const security = await readFile(new URL("../lib/server/security.ts", import.meta.url), "utf8");
  const context = await readFile(new URL("../app/api/auth/facility-context/route.ts", import.meta.url), "utf8");
  assert.match(security, /INNER JOIN organizations o ON o\.id = f\.organization_id AND o\.status = 'ACTIVE'/);
  assert.match(security, /f\.organization_id = sfa\.organization_id/);
  assert.match(context, /INNER JOIN organizations o ON o\.id = f\.organization_id AND o\.status = 'ACTIVE'/);
});

test("visitor facility-backed reads fail closed when the organization is disabled", async () => {
  const routes = [
    "../app/api/visitor/facilities/route.ts",
    "../app/api/visitor/prisoners/route.ts",
    "../app/api/visitor/availability/route.ts",
    "../app/api/visitor/appointment-types/route.ts",
    "../app/api/visitor/appointments/route.ts",
    "../app/api/visitor/payments/route.ts",
    "../app/api/visitor/relationships/route.ts",
    "../app/api/visitor/support/route.ts",
    "../app/api/visitor/notifications/route.ts",
    "../app/api/visitor/verification/evidence/route.ts",
    "../app/api/visitor/appointments/[appointmentId]/device-check/route.ts",
    "../app/api/visitor/appointments/[appointmentId]/waiting-room/route.ts",
    "../app/api/visitor/appointments/[appointmentId]/waiting-room/presence/route.ts",
    "../app/api/visitor/payments/[paymentIntentId]/receipt/route.ts",
  ];
  for (const route of routes) {
    const source = await readFile(new URL(route, import.meta.url), "utf8");
    assert.match(source, /organizations o ON o\.id = f\.organization_id AND o\.status = 'ACTIVE'/, route);
  }
});

test("kiosk authentication and visit operations fail closed when the organization is disabled", async () => {
  const kioskCredentials = await readFile(new URL("../lib/server/kiosk-credentials.ts", import.meta.url), "utf8");
  assert.match(kioskCredentials, /INNER JOIN organizations o ON o\.id = f\.organization_id AND o\.status = 'ACTIVE'/);
  for (const route of [
    "../app/api/kiosk/visits/[visitId]/presence/route.ts",
    "../app/api/kiosk/visits/[visitId]/device-check/route.ts",
    "../app/api/kiosk/visits/[visitId]/live-session/route.ts",
  ]) {
    const source = await readFile(new URL(route, import.meta.url), "utf8");
    assert.match(source, /organizations o ON o\.id = f\.organization_id AND o\.status = 'ACTIVE'/, route);
  }
});

test("control operational reads fail closed when the organization is disabled", async () => {
  for (const route of [
    "../app/api/control/appointments/route.ts",
    "../app/api/control/waiting-room/route.ts",
    "../app/api/control/verification/route.ts",
    "../app/api/control/verification/evidence/route.ts",
    "../app/api/control/verification/evidence/[documentId]/route.ts",
    "../app/api/control/recordings/route.ts",
    "../app/api/control/recordings/[recordingId]/route.ts",
    "../app/api/control/access/break-glass/route.ts",
  ]) {
    const source = await readFile(new URL(route, import.meta.url), "utf8");
    assert.match(source, /organizations o ON o\.id = f\.organization_id AND o\.status = 'ACTIVE'/, route);
  }
});

test("shared appointment and session statements retain the active organization boundary", async () => {
  for (const file of [
    "../lib/server/control-appointments.ts",
    "../lib/server/video/session.ts",
    "../lib/server/visitor-appointment-detail.ts",
    "../lib/server/visitor-appointments.ts",
    "../lib/server/appointment-decisions.ts",
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /organizations o ON o\.id = f\.organization_id AND o\.status = 'ACTIVE'/, file);
  }
});

test("incident assignment rejects revoked modern staff assignments", async () => {
  const incidents = await readFile(new URL("../app/api/control/incidents/route.ts", import.meta.url), "utf8");
  assert.match(incidents, /staff_facility_assignments sfa WHERE sfa\.user_id = u\.id/);
  assert.match(incidents, /staff_facility_assignments sfa2 WHERE sfa2\.user_id = u\.id/);
});

test("facility identity editing uses organization scope rather than a removed facility permission", async () => {
  const facilities = await readFile(new URL("../app/api/control/facilities/[facilityId]/route.ts", import.meta.url), "utf8");
  assert.match(facilities, /requireOrganizationPermission\("organization\.manage"\)/);
  assert.doesNotMatch(facilities, /requirePermission\("organization\.manage"/);
  assert.match(facilities, /f\.organization_id = \?/);
});

test("federated staff login and status changes require an active modern assignment", async () => {
  const oidc = await readFile(new URL("../app/api/auth/staff/oidc/callback/route.ts", import.meta.url), "utf8");
  const saml = await readFile(new URL("../app/api/auth/staff/saml/callback/route.ts", import.meta.url), "utf8");
  const staff = await readFile(new URL("../app/api/control/staff/route.ts", import.meta.url), "utf8");
  for (const source of [oidc, saml, staff]) {
    assert.match(source, /staff_facility_assignments/);
    assert.match(source, /status = 'ACTIVE'/);
    assert.match(source, /NOT EXISTS \(SELECT 1 FROM staff_facility_assignments/);
  }
});

test("federated staff login accepts organization-only administrators without inventing a facility scope", async () => {
  const oidc = await readFile(new URL("../app/api/auth/staff/oidc/callback/route.ts", import.meta.url), "utf8");
  const saml = await readFile(new URL("../app/api/auth/staff/saml/callback/route.ts", import.meta.url), "utf8");
  for (const source of [oidc, saml]) {
    assert.match(source, /organization_role_assignments/);
    assert.match(source, /p\.permission_key = 'organization\.manage'/);
    assert.match(source, /STAFF_SCOPE_MISSING/);
    assert.match(source, /organization_id, facility_id, event_type/);
    assert.match(source, /profile(?:Scope)?\.facility_id \? 'FACILITY' : 'ORGANIZATION'/);
    assert.match(source, /scope_rank/);
    assert.match(source, /ORDER BY scope_rank, facility_id LIMIT 1/);
    assert.match(source, /organizations o ON o\.id =/);
    assert.match(source, /o\.status = 'ACTIVE'/);
  }
});

test("organization authorization fails closed for disabled organizations", async () => {
  const security = await readFile(new URL("../lib/server/security.ts", import.meta.url), "utf8");
  assert.match(security, /SELECT id FROM organizations WHERE id = \? AND status = 'ACTIVE'/);
  assert.match(security, /ORGANIZATION_SCOPE_DENIED/);
});

test("organization-only administration supports an organization with no facilities yet", async () => {
  const security = await readFile(new URL("../lib/server/security.ts", import.meta.url), "utf8");
  const events = await readFile(new URL("../lib/server/events.ts", import.meta.url), "utf8");
  const organizations = await readFile(new URL("../app/api/control/organizations/route.ts", import.meta.url), "utf8");
  assert.match(security, /MIN\(f\.id\) AS facility_id/);
  assert.match(security, /facilityId = organizationRows\.results\[0\]\.facility_id \|\| ""/);
  assert.match(events, /COALESCE\(\?, \(SELECT organization_id FROM facilities WHERE id = \?\)\)/);
  assert.match(organizations, /organizationId: authorization\.organizationId/);
  assert.match(organizations, /facilityId: authorization\.facilityId \|\| null/);
});

test("staff directory and access review hide revoked modern assignments", async () => {
  const staff = await readFile(new URL("../app/api/control/staff/route.ts", import.meta.url), "utf8");
  const review = await readFile(new URL("../app/api/control/access-review/route.ts", import.meta.url), "utf8");
  const sessions = await readFile(new URL("../app/api/control/access-review/sessions/route.ts", import.meta.url), "utf8");
  for (const source of [staff, review, sessions]) {
    assert.match(source, /staff_facility_assignments sfa/);
    assert.match(source, /sfa\.status = 'ACTIVE'/);
    assert.match(source, /NOT EXISTS \(SELECT 1 FROM staff_facility_assignments sfa2/);
  }
});

test("organization authorization can resolve an owner without facility membership", async () => {
  const security = await readFile(new URL("../lib/server/security.ts", import.meta.url), "utf8");
  assert.match(security, /Organization owners\/administrators may intentionally have no facility[\s\S]*membership/);
  assert.match(security, /ORGANIZATION_CONTEXT_REQUIRED/);
  assert.match(security, /MIN\(f\.id\) AS facility_id/);
});

test("organization-level facility creation provisions a modern assignment without legacy profile dependency", async () => {
  const facilities = await readFile(new URL("../app/api/control/facilities/route.ts", import.meta.url), "utf8");
  assert.match(facilities, /SELECT id AS role_id, name FROM roles WHERE name = 'Supervisor'/);
  assert.match(facilities, /FROM users u LEFT JOIN staff_profiles sp/);
  assert.match(facilities, /INSERT INTO staff_facility_assignments \(user_id, organization_id, facility_id/);
  assert.match(facilities, /INSERT INTO user_roles \(user_id, role_id, organization_id, facility_id/);
  assert.match(facilities, /INSERT INTO appointment_types \(id, organization_id, facility_id/);
  assert.match(facilities, /'FAMILY_VIDEO', 'Family video visit'/);
  assert.doesNotMatch(facilities, /FROM staff_profiles WHERE user_id = \? AND facility_id = \?/);
});

test("staff provisioning and directory reads use facility assignments as the multi-facility source of truth", async () => {
  const staff = await readFile(new URL("../app/api/control/staff/route.ts", import.meta.url), "utf8");
  assert.match(staff, /LEFT JOIN staff_facility_assignments sfa ON sfa\.user_id = u\.id/);
  assert.match(staff, /sfa\.facility_id = \? AND sfa\.status = 'ACTIVE'/);
  assert.match(staff, /COALESCE\(sfa\.employee_reference, sp\.employee_reference\)/);
  assert.match(staff, /INSERT INTO staff_facility_assignments \(user_id, organization_id, facility_id/);
  assert.match(staff, /INSERT INTO user_roles \(user_id, role_id, organization_id, facility_id/);
  assert.match(staff, /NOT EXISTS \(SELECT 1 FROM staff_facility_assignments sfa2 WHERE sfa2\.user_id = u\.id\)/);
});
