import { getD1 } from "../../../../db/runtime";
import { getRuntimeValue, securityResponse } from "../../../../lib/server/security";

const requiredTables = ["users", "facilities", "visit_policies", "appointments", "verification_cases", "evidence_documents", "payment_intents", "notifications", "outbox_events", "idempotency_records", "auth_federation_states"];

export async function GET() {
  const environment = await getRuntimeValue("SECUREVISIT_ENVIRONMENT") || "development";
  try {
    const d1 = await getD1();
    const rows = await d1.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
    const present = new Set(rows.results.map((row) => row.name));
    const schemaReady = requiredTables.every((table) => present.has(table));
    return securityResponse({ status: schemaReady ? "ready" : "not_ready", environment, checks: { database: true, schema: schemaReady } }, schemaReady ? 200 : 503);
  } catch {
    return securityResponse({ status: "not_ready", environment, checks: { database: false, schema: false } }, 503);
  }
}
