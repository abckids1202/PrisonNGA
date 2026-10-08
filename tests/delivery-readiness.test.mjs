import assert from "node:assert/strict";
import test from "node:test";
import { isDeliveryConfigured } from "../lib/server/delivery-readiness.ts";

test("delivery readiness accepts only the provider/channel combinations that can actually send", () => {
  assert.equal(isDeliveryConfigured({ environment: "development", delivery: "in_app", channel: "EMAIL" }), true);
  assert.equal(isDeliveryConfigured({ environment: "staging", delivery: "in_app", channel: "EMAIL" }), false);
  assert.equal(isDeliveryConfigured({ environment: "staging", delivery: "webhook", channel: "EMAIL", webhookUrl: "https://notify.example.test/callback", webhookSecret: "secret" }), true);
  assert.equal(isDeliveryConfigured({ environment: "staging", delivery: "webhook", channel: "EMAIL", webhookUrl: "http://notify.example.test/callback", webhookSecret: "secret" }), false);
  assert.equal(isDeliveryConfigured({ environment: "staging", delivery: "resend", channel: "EMAIL", resendApiKey: "re_test", emailFrom: "SecureVisit <no-reply@example.test>" }), true);
  assert.equal(isDeliveryConfigured({ environment: "staging", delivery: "resend", channel: "SMS", resendApiKey: "re_test", emailFrom: "SecureVisit <no-reply@example.test>" }), false);
  assert.equal(isDeliveryConfigured({ environment: "staging", delivery: "twilio", channel: "SMS", twilioAccountSid: "AC123", twilioAuthToken: "secret", twilioFrom: "+15005550006" }), true);
  assert.equal(isDeliveryConfigured({ environment: "staging", delivery: "twilio", channel: "EMAIL", twilioAccountSid: "AC123", twilioAuthToken: "secret", twilioFrom: "+15005550006" }), false);
});
