import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/api/visitor/notifications/route.ts", import.meta.url), "utf8");

test("visitor notification reads require every requested notification to be active and owned", () => {
  assert.match(source, /const activeNotificationGuard =/);
  assert.match(source, /SELECT COUNT\(\*\) FROM notifications n[\s\S]*?INNER JOIN organizations o ON o\.id = f\.organization_id AND o\.status = 'ACTIVE'/);
  assert.match(source, /n\.id IN \(\$\{ids\.map\(\(\) => '\?'\)/);
  assert.match(source, /auditAndOutboxStatements\(database,[\s\S]*?activeNotificationGuard/);
  assert.match(source, /completeIdempotencyStatement\(database,[\s\S]*?guard: activeNotificationGuard/);
});

test("visitor notification updates keep the facility and organization relationship bound", () => {
  assert.match(source, /UPDATE notifications SET read_at = COALESCE\(read_at, \?\)/);
  assert.match(source, /f\.organization_id = notifications\.organization_id/);
  assert.doesNotMatch(source, /read_at IS NULL AND EXISTS/);
});
