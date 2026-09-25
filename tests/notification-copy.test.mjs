import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("outbox notification copy explains critical payment and visit outcomes", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /PAYMENT_CHECKOUT_CREATED/);
  assert.match(source, /PAYMENT_CHECKOUT_FAILED/);
  assert.match(source, /PAYMENT_STATUS_UPDATED/);
  assert.match(source, /PAYMENT_REFUND_REQUESTED/);
  assert.match(source, /Refund completed/);
  assert.match(source, /VISIT_COMPLETED/);
  assert.match(source, /SESSION_TERMINATED/);
  assert.match(source, /Payment confirmation is pending/);
  assert.match(source, /VERIFICATION_MORE_INFO/);
  assert.match(source, /APPOINTMENT_RESCHEDULED/);
  assert.match(source, /EVIDENCE_UPLOADED/);
  assert.match(source, /eventType\.startsWith\("WAITING_ROOM_"\)/);
  assert.match(source, /SESSION_EXPIRED/);
  assert.match(source, /LIVE_SESSION_PROVIDER_CLOSE_FAILED/);
  assert.match(source, /did not confirm that the visit room closed safely/);
  assert.match(source, /recordSessionProviderCloseFailure/);
  assert.match(source, /EXPIRED_SESSION_PROVIDER_UNAVAILABLE/);
  assert.match(source, /authorized session window expired/);
  assert.match(source, /VISITOR_SUSPICIOUS_LOGIN/);
  assert.match(source, /New sign-in detected/);
});
