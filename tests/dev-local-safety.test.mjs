import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("dev:local refuses non-development environment settings", async () => {
  const source = await readFile(new URL("../scripts/dev-local.mjs", import.meta.url), "utf8");
  assert.match(source, /process\.env\.SECUREVISIT_ENVIRONMENT !== "development"/);
  assert.match(source, /refusing to start with staging or production settings/);
});

test("dev:local documents the local product entry points", async () => {
  const source = await readFile(new URL("../scripts/dev-local.mjs", import.meta.url), "utf8");
  assert.match(source, /const localPort/);
  assert.match(source, /http:\/\/localhost:\$\{localPort\}/);
  assert.match(source, /\/visitor/);
  assert.match(source, /\/control/);
  assert.match(source, /\/kiosk/);
});
