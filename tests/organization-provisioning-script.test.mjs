import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("organization provisioning is explicit, remote-only, and transactional", async () => {
  const source = await readFile("scripts/provision-organization.mjs", "utf8");
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(source, /--confirm-organization-provisioning/);
  assert.match(source, /\["staging", "production"\]/);
  assert.match(source, /D1_DATABASE_ID/);
  assert.match(source, /BEGIN IMMEDIATE;/);
  assert.match(source, /COMMIT;/);
  assert.match(source, /role-organization-owner/);
  assert.match(source, /FAMILY_VIDEO/);
  assert.match(source, /audit_events/);
  assert.match(source, /outbox_events/);
  assert.equal(packageJson.scripts["db:provision:organization"], "node --env-file-if-exists=.env.local scripts/provision-organization.mjs");
});
