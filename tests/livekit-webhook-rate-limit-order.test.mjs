import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("LiveKit webhook throttles before parsing untrusted payloads", async () => {
  const source = await readFile(new URL("../app/api/webhooks/livekit/route.ts", import.meta.url), "utf8");
  const rateLimit = source.indexOf("await enforceRateLimit(d1, { key: `livekit-webhook:");
  const bodyRead = source.indexOf("const body = await readTextBodyWithinLimit(request, 256 * 1024);");
  const signatureParse = source.indexOf("new WebhookReceiver(config.apiKey, config.apiSecret).receive");
  assert.ok(rateLimit >= 0, "LiveKit webhook must have an application rate limit");
  assert.ok(bodyRead >= 0, "LiveKit webhook must bound the request body");
  assert.ok(signatureParse >= 0, "LiveKit webhook must verify provider signatures");
  assert.ok(rateLimit < bodyRead, "rate limiting must precede body parsing");
  assert.ok(rateLimit < signatureParse, "rate limiting must precede signature verification");
});
