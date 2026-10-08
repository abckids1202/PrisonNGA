import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/control/access-review/sessions/route.ts", import.meta.url), "utf8");
const panel = await readFile(new URL("../app/components/AccessReviewPanel.tsx", import.meta.url), "utf8");

test("staff session review is facility-scoped and exposes only bounded metadata", () => {
  assert.match(route, /requirePermission\("staff\.manage"\)/);
  assert.match(route, /staff_profiles sp ON sp\.user_id = s\.user_id AND sp\.facility_id = \?/);
  assert.match(route, /LIMIT 250/);
  assert.match(route, /recognized_browser/);
  assert.doesNotMatch(route, /token_hash\s*,/);
  assert.doesNotMatch(route, /ip_hash\s*,/);
});

test("staff session revocation is scoped, replay-safe, and audited", () => {
  assert.match(route, /Idempotency-Key/);
  assert.match(route, /UPDATE auth_sessions SET revoked_at/);
  assert.match(route, /WHERE id = \? AND user_id = \? AND revoked_at IS NULL/);
  assert.match(route, /auditAndOutboxStatements/);
  assert.match(route, /STAFF_SESSION_REVOKED/);
  assert.match(route, /completeIdempotencyStatement/);
});

test("access review UI provides staff session visibility and revocation", () => {
  assert.match(panel, /\/api\/control\/access-review\/sessions/);
  assert.match(panel, /Active staff sessions/);
  assert.match(panel, /Revocation reason/);
  assert.match(panel, /Revoke/);
  assert.match(panel, /recognized_browser/);
});
