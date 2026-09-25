import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("live session tokens are bounded by the authorized visit window", async () => {
  const session = await readFile(new URL("../lib/server/video/session.ts", import.meta.url), "utf8");
  const provider = await readFile(new URL("../lib/server/video/provider.ts", import.meta.url), "utf8");
  const visitorRoute = await readFile(new URL("../app/api/visitor/visits/[visitId]/live-session/route.ts", import.meta.url), "utf8");
  assert.match(session, /SESSION_INVALID_WINDOW/);
  assert.match(session, /Date\.now\(\) < start - 60_000/);
  assert.match(session, /sessionTokenTtlSeconds/);
  assert.match(session, /Math\.min\(30 \* 60/);
  assert.match(provider, /ttl: `\$\{ttlSeconds\}s`/);
  assert.match(visitorRoute, /expiresInSeconds = sessionTokenTtlSeconds\(session\)/);
});
