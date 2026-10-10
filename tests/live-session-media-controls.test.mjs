import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Live Session media controls surface recoverable device failures", async () => {
  const source = await readFile(new URL("../app/features/live-session/LiveSessionClient.tsx", import.meta.url), "utf8");
  assert.match(source, /const \[mediaError, setMediaError\]/);
  assert.match(source, /setMediaError\(next \? "We couldn’t turn on your microphone/);
  assert.match(source, /setMediaError\(next \? "We couldn’t turn on your camera/);
  assert.match(source, /We couldn’t switch to that/);
  assert.match(source, /const statusCopy = mediaError/);
});
