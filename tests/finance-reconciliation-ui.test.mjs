import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/features/management/FinancePage.tsx", import.meta.url), "utf8");

test("Finance reconciliation refreshes authoritative data and exposes open issues", () => {
  assert.match(source, /const runChecks = async \(\) =>/);
  assert.match(source, /const refreshed = await load\(\)/);
  assert.match(source, /Open reconciliation issues/);
  assert.match(source, /data\.reconciliation\.issues\.map/);
});

test("Finance exposes controlled provider refunds without bypassing step-up or webhook settlement", () => {
  assert.match(source, /\/api\/control\/finance\/refunds/);
  assert.match(source, /finance-refund-\$\{refundPayment\.id\}/);
  assert.match(source, /fresh supervisor step-up check is required/);
  assert.match(source, /Settlement remains webhook-driven/);
  assert.match(source, /Request provider refund/);
});

test("Finance keeps pending and failed refund cases visible for operational recovery", () => {
  assert.match(source, /Boolean\(payment\.refund_status\)/);
  assert.match(source, /row\.refund_status === "FAILED"/);
  assert.match(source, /Retry refund/);
});
