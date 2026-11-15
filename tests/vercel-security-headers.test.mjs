import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");

test("Vercel frontend carries the browser security policy for real media sessions", () => {
  assert.match(source, /async headers\(\)/);
  assert.match(source, /Content-Security-Policy/);
  assert.match(source, /connect-src 'self' \$\{liveKitConnectSources\(\)\}/);
  assert.match(source, /Permissions-Policy/);
  assert.match(source, /camera=\(self\), microphone=\(self\)/);
  assert.match(source, /wss:\/\/\*\.livekit\.cloud/);
  assert.match(source, /wss:\/\/\*\.livekit\.io/);
});

test("Vercel frontend adds HSTS only outside development", () => {
  assert.match(source, /SECUREVISIT_ENVIRONMENT.*development/);
  assert.match(source, /Strict-Transport-Security/);
  assert.match(source, /max-age=31536000; includeSubDomains/);
});
