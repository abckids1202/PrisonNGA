import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("shared security headers include the configured LiveKit host in local application mode", async () => {
  const source = await readFile(new URL("../lib/server/security.ts", import.meta.url), "utf8");
  assert.match(source, /function liveKitConnectSources\(\)/);
  assert.match(source, /process\.env\?\.LIVEKIT_URL/);
  assert.match(source, /sources\.add\(origin\)/);
  assert.match(source, /connect-src 'self' \$\{liveKitConnectSources\(\)\}/);
});
