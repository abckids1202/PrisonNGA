import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("external notifications use only verified visitor contact methods", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /email_verified_at, phone_verified_at/);
  assert.match(source, /visitor\.email_verified_at && visitor\.email \? "EMAIL"/);
  assert.match(source, /visitor\.phone_verified_at && visitor\.phone \? "SMS"/);
  assert.match(source, /email: channel === "EMAIL" \? visitor\.email : null/);
  assert.match(source, /phone: channel === "SMS" \? visitor\.phone : null/);
});
