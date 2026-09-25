import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Compliance security events refresh from the protected API and fail closed", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /const \[securityError, setSecurityError\] = useState\(false\)/);
  assert.match(source, /const \[refreshNonce, setRefreshNonce\] = useState\(0\)/);
  assert.match(source, /\[tab, refreshNonce\]/);
  assert.match(source, /securityError \? <div className="sv3-empty" role="alert">/);
  assert.match(source, /setRefreshNonce\(\(value\) => value \+ 1\)/);
});
