import test from "node:test";
import assert from "node:assert/strict";
import { normalizeResendDeliveryEvent, verifyResendWebhook } from "../lib/server/messaging/resend-webhook.ts";

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function signingSecret() {
  return `whsec_${base64Url(new TextEncoder().encode("resend-webhook-secret"))}`;
}

async function signedHeaders(body, secret, timestamp = Math.floor(Date.now() / 1000), id = "msg-event-1") {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("resend-webhook-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
  return new Headers({ "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": `v1,${base64Url(digest)}` });
}

test("Resend events normalize into SecureVisit delivery states", () => {
  const normalized = normalizeResendDeliveryEvent({ type: "email.bounced", data: { email_id: "email-1", bounce: { type: "Permanent", subType: "Suppressed", message: "Mailbox rejected" } } }, "evt-1");
  assert.deepEqual(normalized, { eventId: "evt-1", providerReference: "email-1", status: "BOUNCED", errorCode: "Suppressed", errorMessage: "Mailbox rejected" });
  assert.equal(normalizeResendDeliveryEvent({ type: "domain.created", data: { id: "domain-1" } }, "evt-2"), null);
  assert.throws(() => normalizeResendDeliveryEvent({ type: "email.delivered", data: {} }, "evt-3"), /RESEND_WEBHOOK_INVALID/);
});

test("Resend Svix signatures verify the raw body and reject replay windows", async () => {
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "email-1" } });
  const secret = await signingSecret();
  const now = Math.floor(Date.now() / 1000);
  await verifyResendWebhook(body, await signedHeaders(body, secret, now), secret, now);
  const validHeaders = await signedHeaders(body, secret, now);
  await assert.rejects(() => verifyResendWebhook(`${body} `, validHeaders, secret, now), /RESEND_WEBHOOK_SIGNATURE_INVALID/);
  const staleHeaders = await signedHeaders(body, secret, now - 301);
  await assert.rejects(() => verifyResendWebhook(body, staleHeaders, secret, now), /RESEND_WEBHOOK_TIMESTAMP_INVALID/);
});
