import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Facility workspace exposes the authoritative visit policy editor", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /tab === "Visit Policies" \? <VisitPolicyEditor \/>/);
});
