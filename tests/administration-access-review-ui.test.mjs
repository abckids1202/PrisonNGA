import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const panel = await readFile(new URL("../app/components/AccessReviewPanel.tsx", import.meta.url), "utf8");

test("Administration roles tab opens the facility-scoped persisted access review", () => {
  assert.match(page, /import AccessReviewPanel from "\.\/components\/AccessReviewPanel"/);
  assert.match(page, /tab === "Roles & Permissions" \? <AccessReviewPanel \/>/);
  assert.match(panel, /\/api\/control\/access-review/);
  assert.match(panel, /active_session_count/);
});
