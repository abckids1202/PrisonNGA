import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("lockdown controls wait for the persisted facility state before reporting success", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /async function confirmLockdown\(reason: string, details: string\)/);
  assert.match(source, /await onFacilityStateChange\("LOCKDOWN"/);
  assert.match(source, /The facility restriction was not saved/);
  assert.match(source, /async function restoreOperations\(\)/);
  assert.match(source, /await onFacilityStateChange\("NORMAL_OPERATIONS"/);
  assert.match(source, /Normal operations could not be restored/);
  assert.match(source, /void \(lockdown \? restoreOperations\(\) : setLockdownDialog\(true\)\)/);
});
