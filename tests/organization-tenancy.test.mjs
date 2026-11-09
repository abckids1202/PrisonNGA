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

test("organization administration does not enumerate facilities through visitor memberships", async () => {
  const source = await readFile(new URL("../app/api/control/organizations/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /organization_memberships/);
  assert.match(source, /WHERE f\.organization_id = \?/);
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
