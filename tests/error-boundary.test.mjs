import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const boundary = await readFile(new URL("../app/error.tsx", import.meta.url), "utf8");
const globalBoundary = await readFile(new URL("../app/global-error.tsx", import.meta.url), "utf8");

test("route errors render a recoverable, privacy-safe boundary", () => {
  assert.match(boundary, /use client/);
  assert.match(boundary, /Try again/);
  assert.match(boundary, /Return home/);
  assert.match(boundary, /saved visit information has not been changed/);
  assert.match(boundary, /error\.digest/);
  assert.doesNotMatch(boundary, /error\.message/);
});

test("global errors keep the product fail-safe and avoid claiming a transaction", () => {
  assert.match(globalBoundary, /temporarily unavailable/);
  assert.match(globalBoundary, /No visit or payment action was confirmed/);
  assert.match(globalBoundary, /Return to SecureVisit/);
});
