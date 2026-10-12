import assert from "node:assert/strict";
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
