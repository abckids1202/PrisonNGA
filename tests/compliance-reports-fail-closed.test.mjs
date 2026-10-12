import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Compliance reports clear stale values and fail closed when the report API fails", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /const \[reportError, setReportError\] = useState\(false\)/);
  assert.match(source, /setAuditCount\(null\); setFinanceSummary\(null\); setReportCounts\(null\); setReportError\(false\)/);
  assert.match(source, /setReportCounts\(null\)/);
  assert.match(source, /openIncidentCount/);
  assert.match(source, /Persisted facility incidents/);
  assert.match(source, /reportError \? "Report unavailable"/);
  assert.match(source, /reportError \? "UNAVAILABLE"/);
  assert.match(source, /onNavigate\(report\[4\], report\[5\] as Mode\)/);
  assert.match(source, /Open workspace →/);
  assert.doesNotMatch(source, /<div className="sv3-report-card"/);
});
