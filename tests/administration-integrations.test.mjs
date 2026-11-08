import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Administration integrations tab reads protected readiness state", async () => {
  const source = await readFile(new URL("../app/features/management/AdministrationPage.tsx", import.meta.url), "utf8");
  const readinessSource = await readFile(new URL("../app/features/management/IntegrationReadinessPanel.tsx", import.meta.url), "utf8");
  const complianceSource = await readFile(new URL("../app/features/management/CompliancePageInteractive.tsx", import.meta.url), "utf8");
  assert.match(readinessSource, /function IntegrationReadinessPanel/);
  assert.match(readinessSource, /fetch\("\/api\/health\/readiness"/);
  assert.match(readinessSource, /providerConfiguration/);
  assert.match(readinessSource, /providerAdapters/);
  assert.match(readinessSource, /Active adapters/);
  assert.match(readinessSource, /releaseGates/);
  assert.match(readinessSource, /Institutional launch gates/);
  assert.match(readinessSource, /LOCAL ONLY/);
  assert.match(readinessSource, /LOCAL DEVELOPMENT ONLY/);
  assert.match(readinessSource, /pilot readiness is not being evaluated here/);
  assert.match(readinessSource, /Launch remains blocked/);
  assert.match(complianceSource, /createReconciliationIncident/);
  assert.match(complianceSource, /security-event-incident-/);
  assert.match(complianceSource, /Create incident/);
  assert.match(complianceSource, /linkedIncidentId/);
  assert.match(complianceSource, /sourceSecurityEventId: event.id/);
  assert.match(readinessSource, /Secret values are never returned/);
  assert.match(source, /tab === "Integrations" \? <IntegrationReadinessPanel/);
});

test("Organization Roles UI uses the organization-scoped, audited mutation boundary", async () => {
  const source = await readFile(new URL("../app/features/management/AdministrationPage.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../app/components/OrganizationRolesPanel.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/control/organization-roles/route.ts", import.meta.url), "utf8");
  const staffRoute = await readFile(new URL("../app/api/control/staff/route.ts", import.meta.url), "utf8");
  assert.match(source, /tab === "Organization Roles" \? <OrganizationRolesPanel/);
  assert.match(panel, /fetch\("\/api\/control\/organization-roles"/);
  assert.match(panel, /Idempotency-Key/);
  assert.match(panel, /expectedVersion/);
  assert.match(panel, /STEP_UP_REQUIRED/);
  assert.match(route, /eligibleStaff/);
  assert.match(route, /organization_memberships/);
  assert.match(staffRoute, /INSERT INTO organization_memberships/);
});

test("Organization administration exposes persisted facility creation and version-safe edits", async () => {
  const source = await readFile(new URL("../app/components/OrganizationFacilitiesPanel.tsx", import.meta.url), "utf8");
  const facilities = await readFile(new URL("../app/api/control/facilities/route.ts", import.meta.url), "utf8");
  const facility = await readFile(new URL("../app/api/control/facilities/[facilityId]/route.ts", import.meta.url), "utf8");
  assert.match(source, /fetch\("\/api\/control\/facilities"/);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /expectedVersion/);
  assert.match(source, /STEP_UP_REQUIRED/);
  assert.match(facilities, /INSERT INTO facilities/);
  assert.match(facilities, /INSERT INTO visit_policies/);
  assert.match(facilities, /organization_memberships/);
  assert.match(facility, /STALE_FACILITY/);
});

test("Facility Access UI uses the persisted organization membership workflow", async () => {
  const source = await readFile(new URL("../app/components/OrganizationMembershipsPanel.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/control/memberships/route.ts", import.meta.url), "utf8");
  assert.match(source, /fetch\("\/api\/control\/memberships"/);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /expectedVersion/);
  assert.match(source, /STEP_UP_REQUIRED/);
  assert.match(route, /staff_facility_assignments/);
  assert.match(route, /MEMBERSHIP_ALREADY_ACTIVE/);
  assert.match(route, /STALE_MEMBERSHIP/);
  assert.match(route, /organization_memberships/);
});
