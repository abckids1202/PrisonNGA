import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("request context only uses forwarded IP fallback in development", async () => {
  const source = await readFile(new URL("../lib/server/security.ts", import.meta.url), "utf8");
  assert.match(source, /const cloudflareIp = requestHeaders\.get\("cf-connecting-ip"\)/);
  assert.match(source, /environment === "development"/);
  assert.match(source, /requestHeaders\.get\("x-forwarded-for"\)/);
  assert.match(source, /cloudflareIp \|\| developmentForwardedIp \|\| null/);
});
