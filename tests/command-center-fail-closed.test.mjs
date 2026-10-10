import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Command Center does not present unavailable appointment data as zero attention", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /const operationalDataUnavailable = backendStatus !== "connected"/);
  assert.match(source, /value=\{operationalDataUnavailable \? "—" : String\(attention\)\}/);
  assert.match(source, /Protected appointment data unavailable/);
  assert.match(source, /Persisted visit data unavailable/);
  assert.match(source, /const \[resourcesError, setResourcesError\] = useState\(false\)/);
  assert.match(source, /const roomCapacity = resourcesLoading \|\| resourcesError \? "—"/);
  assert.match(source, /No zero-session state is being inferred/);
  assert.match(source, /No empty queue is being inferred/);
});
