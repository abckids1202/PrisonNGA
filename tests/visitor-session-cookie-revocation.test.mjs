import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("visitor session revocation clears the browser cookie when the current session is revoked", async () => {
  const source = await readFile(new URL("../app/api/auth/sessions/route.ts", import.meta.url), "utf8");
  assert.match(source, /clearSessionCookie\("securevisit_session"/);
  assert.match(source, /clearsCurrentVisitorCookie/);
  assert.match(source, /targetSession\?\.token_hash === account\.tokenHash/);
});
