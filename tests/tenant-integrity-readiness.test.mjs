import assert from "node:assert/strict";
import test from "node:test";
import { checkTenantIntegrity } from "../lib/server/tenant-integrity.ts";

test("tenant readiness scan fails closed on denormalized scope mismatches", async () => {
  const database = {
    prepare: (sql) => ({ sql }),
    batch: async (statements) => statements.map((statement) => statement.sql.includes("INNER JOIN appointments t")
      ? { results: [{ facility_id: "facility-a", organization_id: "org-a", mismatch_count: 2 }] }
      : { results: [] }),
  };
  const result = await checkTenantIntegrity(database);
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues[0], { table: "appointments", facilityId: "facility-a", organizationId: "org-a", mismatchCount: 2 });
});
