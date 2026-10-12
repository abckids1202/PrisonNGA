import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/api/control/finance/payment-events/route.ts", import.meta.url), "utf8");
const financePage = await readFile(new URL("../app/features/management/FinancePage.tsx", import.meta.url), "utf8");

test("payment provider event replay is finance-scoped, step-up protected, and facility-scoped", () => {
  assert.match(source, /requirePermission\("finance\.read"\)/);
  assert.match(source, /requirePermission\("finance\.manage"\)/);
  assert.match(source, /requireStepUp\(\{ purpose: "payment_event_replay"/);
  assert.match(source, /pi\.facility_id = \?/);
  assert.match(source, /status IN \('FAILED', 'DEAD_LETTER'\)/);
  assert.match(source, /status = 'RECEIVED'/);
});

test("payment provider event replay resets retry state with idempotent audit evidence", () => {
  assert.match(source, /claimIdempotency/);
  assert.match(source, /completeIdempotencyStatement/);
  assert.match(source, /PAYMENT_PROVIDER_EVENT_REPLAYED/);
  assert.match(source, /attempt_count = 0/);
  assert.match(source, /processing_started_at = NULL/);
  assert.match(source, /last_error = NULL/);
  assert.match(source, /PAYMENT_EVENT_REPLAY_INCOMPLETE/);
});

test("Finance exposes persisted payment recovery events and does not hide the step-up boundary", () => {
  assert.match(financePage, /\/api\/control\/finance\/payment-events/);
  assert.match(financePage, /Provider event recovery/);
  assert.match(financePage, /Replay · step-up/);
  assert.match(financePage, /Replay never settles money directly/);
});
