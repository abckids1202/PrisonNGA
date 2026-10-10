import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cases = [
  ["payment", "../app/api/webhooks/payments/route.ts", "payment-webhook:", "const rawBody = await readTextBodyWithinLimit(request, 256 * 1024);", "verifyPaymentWebhookSignature"],
  ["notification status", "../app/api/webhooks/notifications/status/route.ts", "notification-status-webhook:", "const rawBody = await readTextBodyWithinLimit(request, 64 * 1024);", "verifyPaymentWebhookSignature"],
  ["LiveKit", "../app/api/webhooks/livekit/route.ts", "livekit-webhook:", "const body = await readTextBodyWithinLimit(request, 256 * 1024);", "new WebhookReceiver(config.apiKey, config.apiSecret).receive"],
];

for (const [label, path, key, bodyReadText, verifierText] of cases) {
  test(`${label} webhook throttles before parsing and verification`, async () => {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    const rateLimit = source.indexOf(`await enforceRateLimit(d1, { key: \`${key}`);
    const bodyRead = source.indexOf(bodyReadText);
    const verifier = source.lastIndexOf(verifierText);
    assert.ok(rateLimit >= 0, `${label} webhook must have an application rate limit`);
    assert.ok(bodyRead >= 0, `${label} webhook must bound the request body`);
    assert.ok(verifier >= 0, `${label} webhook must verify its provider signature`);
    assert.ok(rateLimit < bodyRead, `${label} rate limiting must precede body parsing`);
    assert.ok(rateLimit < verifier, `${label} rate limiting must precede verification`);
  });
}
