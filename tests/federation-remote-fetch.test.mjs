import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helper = await readFile(new URL("../lib/server/auth/remote-fetch.ts", import.meta.url), "utf8");
const oidc = await readFile(new URL("../lib/server/auth/oidc.ts", import.meta.url), "utf8");
const saml = await readFile(new URL("../lib/server/auth/saml.ts", import.meta.url), "utf8");

test("federation provider responses are time-limited and size-bounded", () => {
  assert.match(helper, /AbortController/);
  assert.match(helper, /setTimeout/);
  assert.match(helper, /REMOTE_RESPONSE_TOO_LARGE/);
  assert.match(helper, /maxBytes/);
  assert.equal((oidc.match(/fetchBoundedText\(/g) || []).length, 3);
  assert.match(saml, /fetchBoundedText\(/);
  assert.match(saml, /maxBytes: 2 \* 1024 \* 1024/);
});
