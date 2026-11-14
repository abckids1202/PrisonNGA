import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditRouteMatrix, routeMatchesMatrixPattern } from "../scripts/audit-route-matrix.mjs";

test("route matrix covers every API route in the repository", async () => {
  const result = await auditRouteMatrix();
  assert.equal(result.ok, true, `Uncovered API routes: ${result.uncoveredRoutes.join(", ")}`);
  assert.ok(result.routes.length > 50);
});

test("route matrix matching supports parameter and family patterns", () => {
  assert.equal(routeMatchesMatrixPattern("/api/control/audit/export/[exportId]", "/api/control/audit/export/:exportId"), true);
  assert.equal(routeMatchesMatrixPattern("/api/kiosk/visits/[visitId]/presence", "/api/kiosk/*"), true);
  assert.equal(routeMatchesMatrixPattern("/api/visitor/visits/[visitId]/live-session", "/api/visitor/visits/*/live-session"), true);
  assert.equal(routeMatchesMatrixPattern("/api/control/people", "/api/control/prisoners"), false);
});

test("recording policy has a dedicated facility-scoped API boundary", async () => {
  const source = await readFile(new URL("../app/api/control/recording-policy/route.ts", import.meta.url), "utf8");
  assert.match(source, /visit-policy\/route/);
  const matrix = await readFile(new URL("../docs/ROUTE_SECURITY_MATRIX.md", import.meta.url), "utf8");
  assert.match(matrix, /`\/api\/control\/recording-policy`/);
});

test("recording detail has a dedicated security-matrix entry", async () => {
  const source = await readFile(new URL("../app/api/control/recordings/[recordingId]/route.ts", import.meta.url), "utf8");
  assert.match(source, /requirePermission\("recording\.manage"\)/);
  const matrix = await readFile(new URL("../docs/ROUTE_SECURITY_MATRIX.md", import.meta.url), "utf8");
  assert.match(matrix, /`\/api\/control\/recordings\/:recordingId`/);
});
