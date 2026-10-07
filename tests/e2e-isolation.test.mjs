import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release browser checks use disposable isolated D1 state", async () => {
  const [runner, verifier, vite] = await Promise.all([
    readFile(new URL("../scripts/run-e2e.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/verify-release.mjs", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  ]);
  assert.match(runner, /SECUREVISIT_E2E_ISOLATED/);
  assert.match(runner, /mkdtemp/);
  assert.match(runner, /SECUREVISIT_LOCAL_D1_STATE_DIR/);
  assert.match(runner, /\[playwrightCli, "test"/);
  assert.match(verifier, /SECUREVISIT_E2E_ISOLATED: "true"/);
  assert.match(vite, /persistState:/);
  assert.match(vite, /SECUREVISIT_LOCAL_D1_STATE_DIR/);
});
