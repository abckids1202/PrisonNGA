import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("organization administration uses a dedicated organization-role boundary", async () => {
  const security = await readFile(new URL("../lib/server/security.ts", import.meta.url), "utf8");
  const organizations = await readFile(new URL("../app/api/control/organizations/route.ts", import.meta.url), "utf8");
  const facilities = await readFile(new URL("../app/api/control/facilities/route.ts", import.meta.url), "utf8");
  const memberships = await readFile(new URL("../app/api/control/memberships/route.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0061_organization_role_assignments.sql", import.meta.url), "utf8");

  assert.match(security, /export async function requireOrganizationPermission/);
  assert.match(security, /organization_role_assignments/);
  assert.match(organizations, /requireOrganizationPermission\("organization\.manage"\)/);
  assert.match(facilities, /requireOrganizationPermission\("organization\.manage"\)/);
  assert.match(memberships, /requireOrganizationPermission\("organization\.manage"\)/);
  assert.match(migration, /CREATE TABLE `organization_role_assignments`/);
  assert.match(migration, /p\.permission_key = 'organization\.manage'/);
});

test("organization administration does not enumerate facilities through visitor memberships", async () => {
  const source = await readFile(new URL("../app/api/control/organizations/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /organization_memberships/);
  assert.match(source, /WHERE f\.organization_id = \?/);
});
