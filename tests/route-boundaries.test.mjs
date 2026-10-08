import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("root loading boundary is accessible and privacy-safe", async () => {
  const source = await readFile(new URL("app/loading.tsx", root), "utf8");
  assert.match(source, /aria-busy="true"/);
  assert.match(source, /Loading your secure workspace/);
  assert.doesNotMatch(source, /payment|credit|visitor|prisoner/i);
});

test("visitor loading boundary does not invent visit state", async () => {
  const source = await readFile(new URL("app/visitor/loading.tsx", root), "utf8");
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /Preparing your visits and account/);
  assert.doesNotMatch(source, /approved|completed|ready|success/i);
});

test("not-found boundary gives a safe recovery path", async () => {
  const source = await readFile(new URL("app/not-found.tsx", root), "utf8");
  assert.match(source, /from "next\/link"/);
  assert.match(source, /Your account and visit data have not been changed/);
  assert.match(source, /href="\/"/);
});
