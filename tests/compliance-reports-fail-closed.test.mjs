import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Compliance reports clear stale values and fail closed when the report API fails", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /const \[reportError, setReportError\] = useState\(false\)/);
  assert.match(source, /setAuditCount\(null\); setFinanceSummary\(null\); setReportError\(false\)/);
  assert.match(source, /reportError \? "Report unavailable"/);
  assert.match(source, /reportError \? "UNAVAILABLE"/);
});
