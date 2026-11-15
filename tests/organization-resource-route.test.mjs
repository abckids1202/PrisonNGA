import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/control/organizations/[organizationId]/route.ts", import.meta.url), "utf8");

test("organization resource route enforces the authenticated organization path", () => {
  assert.match(route, /requireOrganizationPermission\("organization\.manage"\)/);
  assert.match(route, /authorization\.organizationId !== organizationId/);
  assert.match(route, /ORGANIZATION_SCOPE_DENIED/);
  assert.match(route, /o\.status = 'ACTIVE'/);
  assert.match(route, /f\.organization_id = \?/);
});

test("organization resource mutations reuse the canonical audited handler", () => {
  assert.match(route, /import \{ PATCH as updateOrganization \} from "\.\.\/route"/);
  assert.match(route, /return await updateOrganization\(request\)/);
});
