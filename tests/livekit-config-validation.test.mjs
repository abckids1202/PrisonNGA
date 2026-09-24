import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("LiveKit configuration fails closed for unsafe or credential-bearing URLs", async () => {
  const provider = await readFile(new URL("../lib/server/video/provider.ts", import.meta.url), "utf8");
  const config = await readFile(new URL("../lib/server/config.ts", import.meta.url), "utf8");
  assert.match(provider, /url\.protocol === "wss:" \|\| url\.protocol === "https:"/);
  assert.match(provider, /!url\.username && !url\.password/);
  assert.match(config, /LIVEKIT_URL \(must be an https:\/\/ or wss:\/\/ URL without credentials\)/);
});
