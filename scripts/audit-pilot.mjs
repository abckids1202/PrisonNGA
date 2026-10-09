import { validateEnvironment } from "../lib/server/config.ts";
import { evaluateReleaseGates } from "../lib/server/release-gates.ts";

const values = { ...process.env, DB: {} };
const environment = String(values.SECUREVISIT_ENVIRONMENT || "invalid").trim() || "invalid";
const strict = process.argv.includes("--strict");
const environmentCheck = validateEnvironment(values);
const releaseGates = evaluateReleaseGates(environment, values);

const present = (key) => typeof values[key] === "string" && values[key].trim().length > 0;
const httpsUrl = (key) => {
  if (!present(key)) return false;
  try {
    const url = new URL(values[key].trim());
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
};

const checks = [
  { id: "environment", label: "Explicit runtime environment", ok: environmentCheck.environment !== "invalid", detail: environmentCheck.environment },
  { id: "public-domain", label: "HTTPS public application domain", ok: httpsUrl("PUBLIC_APP_URL"), detail: "PUBLIC_APP_URL" },
  { id: "remote-database", label: "Remote D1 identity", ok: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(values.D1_DATABASE_ID || "").trim()), detail: "D1_DATABASE_ID" },
  { id: "evidence-storage", label: "Protected evidence storage", ok: String(values.EVIDENCE_STORAGE_PROVIDER || "").trim().toLowerCase() === "r2", detail: "EVIDENCE_STORAGE_PROVIDER=r2" },
  { id: "queue", label: "Notification queue binding", ok: true, detail: present("NOTIFICATION_QUEUE_NAME") ? "configured" : "cron fallback remains enabled" },
  { id: "environment-config", label: "Provider and secret configuration", ok: environmentCheck.ok, detail: environmentCheck.ok ? "validated" : `${environmentCheck.missing.length} requirement(s) missing` },
  { id: "release-gates", label: "Institutional release evidence", ok: environment !== "production" || releaseGates.ready, detail: environment !== "production" ? "not required outside production" : releaseGates.ready ? "all gates attested" : `${releaseGates.missing.length} gate(s) missing` },
];

const report = {
  generatedAt: new Date().toISOString(),
  environment: environmentCheck.environment,
  strict,
  readyForPilot: environmentCheck.environment !== "development" && environmentCheck.ok && releaseGates.ready && checks.every((check) => check.ok),
  checks,
  missingConfiguration: environmentCheck.missing,
  warnings: environmentCheck.warnings,
  missingReleaseEvidence: releaseGates.missing,
  nextActions: [
    ...environmentCheck.missing.map((item) => `Configure ${item}`),
    ...releaseGates.missing.map((item) => `Record release evidence for ${item}`),
    ...checks.filter((check) => !check.ok && check.id === "remote-database").map(() => "Set D1_DATABASE_ID to the real remote database UUID"),
  ],
};

console.log(JSON.stringify(report, null, 2));
if (strict && !report.readyForPilot) process.exitCode = 1;
