import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseVisitorAuthChannels } from "../lib/server/visitor-auth/channels.ts";
import { validateEnvironment } from "../lib/server/config.ts";

test("visitor authentication defaults to both channels and parses explicit scopes", () => {
  assert.deepEqual(parseVisitorAuthChannels(undefined), { channels: ["EMAIL", "SMS"], valid: true, emailOnly: false });
  assert.deepEqual(parseVisitorAuthChannels("EMAIL"), { channels: ["EMAIL"], valid: true, emailOnly: true });
  assert.equal(parseVisitorAuthChannels("SMS").channels[0], "SMS");
  assert.equal(parseVisitorAuthChannels("carrier").valid, false);
});

test("email-only staging scope requires an explicit approval and does not require SMS credentials", () => {
  const base = {
    DB: {},
    SECUREVISIT_ENVIRONMENT: "staging",
    VISITOR_AUTH_CHANNELS: "EMAIL",
    VISITOR_AUTH_DELIVERY: "webhook",
    VISITOR_AUTH_WEBHOOK_URL: "https://auth.example.test/send",
    VISITOR_AUTH_WEBHOOK_SECRET: "v".repeat(32),
  };
  const withoutApproval = validateEnvironment(base);
  assert.ok(withoutApproval.missing.includes("SECUREVISIT_VISITOR_EMAIL_ONLY_APPROVAL=approved"));
  const withApproval = validateEnvironment({ ...base, SECUREVISIT_VISITOR_EMAIL_ONLY_APPROVAL: "approved" });
  assert.equal(withApproval.missing.some((item) => item.includes("VISITOR_SMS_TWILIO")), false);
});

test("visitor auth request exposes the enabled channels and rejects disabled channels", async () => {
  const source = await readFile(new URL("../app/api/auth/visitor/request/route.ts", import.meta.url), "utf8");
  assert.match(source, /export async function GET/);
  assert.match(source, /channels: policy\.channels/);
  assert.match(source, /AUTH_CHANNEL_DISABLED/);
  assert.match(source, /parseVisitorAuthChannels/);
});
