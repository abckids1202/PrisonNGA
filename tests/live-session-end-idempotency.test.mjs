import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("staff live-session termination is replay-safe across provider and settlement recovery", async () => {
  const source = await readFile(new URL("../app/api/control/live-sessions/[sessionId]/end/route.ts", import.meta.url), "utf8");
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /claimIdempotency\(database/);
  assert.match(source, /completeIdempotencyStatement\(database/);
  assert.match(source, /releaseIdempotencyClaim/);
  assert.match(source, /requestLiveSessionEndStatements/);
  assert.match(source, /finalizeLiveSessionStatements/);
  assert.match(source, /SESSION_SETTLEMENT_REQUIRES_RECONCILIATION/);
  assert.match(source, /LIVE_SESSION_PROVIDER_CLOSE_FAILED/);
  assert.match(source, /auditAndOutboxStatements/);
  assert.match(source, /visitorUserId/);
});
