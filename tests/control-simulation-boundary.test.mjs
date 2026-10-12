import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Control simulation controls are enabled only for the development environment", async () => {
  const source = await readFile(new URL("../app/features/control/CommandCenterPage.tsx", import.meta.url), "utf8");
  const shellSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(shellSource, /demoMode=\{runtimeEnvironment === "development"\}/);
  assert.match(shellSource, /\{runtimeEnvironment === "development" && popover === "demo"/);
  assert.match(source, /\{demoMode \? <div className="sv3-simulation-bar/);
});
