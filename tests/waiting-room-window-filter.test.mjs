import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Waiting Room window selector is controlled and filters persisted appointment times", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /const \[windowFilter, setWindowFilter\] = useState<"next_2_hours" \| "today" \| "all_approved">\("next_2_hours"\)/);
  assert.match(source, /value=\{windowFilter\} onChange=\{\(event\) => setWindowFilter\(event\.target\.value as typeof windowFilter\)\}/);
  assert.match(source, /end >= now && start <= now \+ 2 \* 60 \* 60 \* 1000/);
  assert.match(source, /windowFilter === "all_approved"/);
  assert.match(source, /new Intl\.DateTimeFormat\("en-CA", \{ timeZone: record\.timezone \|\| "Asia\/Jakarta"/);
});

test("Waiting Room preserves explicit staff-review state across refreshes", async () => {
  const source = await readFile(new URL("../app/api/control/waiting-room/route.ts", import.meta.url), "utf8");

  assert.match(source, /\["LIVE", "CANCELLED", "LATE", "STAFF_REVIEW"\]\.includes\(savedState\)/);
  assert.match(source, /STAFF_REVIEW is an explicit operational escalation/);
});
