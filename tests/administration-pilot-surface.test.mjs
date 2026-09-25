import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("Administration pilot navigation does not expose an unconnected System Settings surface", () => {
  assert.match(source, /\["Staff", "Roles & Permissions", "Notifications", "Integrations"\]\.map/);
  assert.doesNotMatch(source, /System Settings/);
  assert.doesNotMatch(source, /NOT CONNECTED.*persisted configuration workflow/);
});
