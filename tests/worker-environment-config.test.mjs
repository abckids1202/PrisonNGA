import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Cloudflare local Worker vars include env-file values without overriding explicit test overrides", async () => {
  const source = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(source, /loadEnv\("development", process\.cwd\(\), ""\)/);
  assert.match(source, /process\.env\[key\] \|\| loadedLocalEnvironment\[key\]/);
  assert.match(source, /runtimeEnvironmentValue\(key\)/);
  assert.match(source, /isolatedDevelopmentE2E/);
  assert.match(source, /"VIDEO_PROVIDER"/);
  assert.match(source, /"LIVEKIT_URL"/);
  assert.match(source, /"LIVEKIT_API_KEY"/);
  assert.match(source, /"LIVEKIT_API_SECRET"/);
  assert.match(source, /PAYMENT_PROVIDER: "local_test"/);
  assert.match(source, /PAYMENT_WEBHOOK_SECRET: "local-development-payment-webhook-secret-0123456789"/);
  assert.match(source, /EVIDENCE_STORAGE_PROVIDER: "local_test"/);
});
