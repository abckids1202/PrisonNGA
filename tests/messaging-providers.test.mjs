import assert from "node:assert/strict";
import test from "node:test";
import { sendEmailWithResend, sendSmsWithTwilio } from "../lib/server/messaging/providers.ts";

function withEnvironment(values, callback) {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  return Promise.resolve(callback()).finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("Resend adapter sends a bounded, idempotent JSON request and returns its message id", async () => {
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({ id: "resend-message-1" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const receipt = await withEnvironment({ RESEND_API_KEY: "re_test_key", VISITOR_EMAIL_FROM: "SecureVisit <no-reply@example.test>" }, () => sendEmailWithResend({ destination: "visitor@example.test", subject: "Code", text: "123456", idempotencyKey: "challenge-1" }));
    assert.deepEqual(receipt, { providerReference: "resend-message-1" });
    assert.equal(request.input, "https://api.resend.com/emails");
    assert.equal(request.init?.method, "POST");
    assert.equal(request.init?.headers?.authorization, "Bearer re_test_key");
    assert.equal(request.init?.headers?.["idempotency-key"], "challenge-1");
    assert.deepEqual(JSON.parse(String(request.init?.body)), { from: "SecureVisit <no-reply@example.test>", to: ["visitor@example.test"], subject: "Code", text: "123456" });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Twilio adapter sends form-encoded SMS requests with a stable idempotency key", async () => {
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({ sid: "SM0001" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  try {
    const receipt = await withEnvironment({ VISITOR_SMS_TWILIO_ACCOUNT_SID: "AC123", VISITOR_SMS_TWILIO_AUTH_TOKEN: "twilio-secret", VISITOR_SMS_TWILIO_FROM: "+62123456789" }, () => sendSmsWithTwilio({ destination: "+628123456789", body: "Your code is 123456", idempotencyKey: "challenge-2" }));
    assert.deepEqual(receipt, { providerReference: "SM0001" });
    assert.equal(request.input, "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    assert.equal(request.init?.method, "POST");
    assert.match(request.init?.headers?.authorization, /^Basic /);
    assert.equal(request.init?.headers?.["idempotency-key"], "challenge-2");
    const form = new URLSearchParams(String(request.init?.body));
    assert.equal(form.get("To"), "+628123456789");
    assert.equal(form.get("From"), "+62123456789");
    assert.equal(form.get("Body"), "Your code is 123456");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
