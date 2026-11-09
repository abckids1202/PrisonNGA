import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("break-glass access is organization-scoped across request, decision, and consumption", async () => {
  const migration = await readFile(new URL("../drizzle/0071_break_glass_organization_scope.sql", import.meta.url), "utf8");
  const requestRoute = await readFile(new URL("../app/api/control/access/break-glass/route.ts", import.meta.url), "utf8");
  const decisionRoute = await readFile(new URL("../app/api/control/access/break-glass/[requestId]/route.ts", import.meta.url), "utf8");
  const security = await readFile(new URL("../lib/server/security.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(migration, /ADD COLUMN `organization_id`/);
  assert.match(migration, /UPDATE `break_glass_requests`/);
  assert.match(requestRoute, /INSERT INTO break_glass_requests \(id, organization_id/);
  assert.match(requestRoute, /WHERE organization_id = \? AND facility_id = \?/);
  assert.match(decisionRoute, /organization_id = \?/);
  assert.match(security, /WHERE organization_id = \? AND facility_id = \? AND target_type/);
  assert.match(worker, /FROM break_glass_requests WHERE organization_id IS NOT NULL/);
});

test("break-glass approval cannot be self-approved by the requester", async () => {
  const source = await readFile(new URL("../app/api/control/access/break-glass/[requestId]/route.ts", import.meta.url), "utf8");
  assert.match(source, /BREAK_GLASS_SELF_APPROVAL_FORBIDDEN/);
  assert.match(source, /current\.requested_by === authorization\.userId/);
});
