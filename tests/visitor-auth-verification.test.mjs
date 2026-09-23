import assert from "node:assert/strict";
import test from "node:test";

test("visitor verification keeps account and session creation in one guarded batch", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../app/api/auth/visitor/verify/route.ts", import.meta.url), "utf8");
  assert.match(source, /await d1\.batch\(\[/);
  assert.match(source, /UPDATE auth_challenges SET consumed_at/);
  assert.match(source, /INSERT INTO auth_sessions/);
  assert.match(source, /NOT EXISTS \(SELECT 1 FROM users WHERE email = \? AND user_type <> 'VISITOR'\)/);
  assert.match(source, /users\.status = 'ACTIVE'/);
});
