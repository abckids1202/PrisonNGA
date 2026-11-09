import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localPlaceholder = "00000000-0000-4000-8000-000000000000";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const timezonePattern = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/;

function argument(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : "";
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

if (process.argv.includes("--help")) {
  console.log("Usage: npm run db:provision:organization -- --confirm-organization-provisioning --organization-name=... --organization-slug=... --facility-name=... --timezone=Asia/Jakarta --owner-email=... --owner-name=... --owner-reference=...");
  process.exit(0);
}

if (!process.argv.includes("--confirm-organization-provisioning")) throw new Error("Refusing organization provisioning without --confirm-organization-provisioning.");
const environment = String(process.env.SECUREVISIT_ENVIRONMENT || "").trim().toLowerCase();
if (!["staging", "production"].includes(environment)) throw new Error("Organization provisioning requires SECUREVISIT_ENVIRONMENT=staging or production.");
if (environment === "production" && !argument("change-ticket")) throw new Error("Production organization provisioning requires --change-ticket=... for the operator record.");

const databaseId = String(process.env.D1_DATABASE_ID || "").trim();
const databaseName = String(process.env.D1_DATABASE_NAME || "securevisit").trim();
if (!uuidPattern.test(databaseId) || databaseId === localPlaceholder) throw new Error("D1_DATABASE_ID must be a real Cloudflare D1 UUID.");
if (!databaseName || databaseName.length > 64) throw new Error("D1_DATABASE_NAME is required and must be short.");

const organizationName = argument("organization-name");
const organizationSlug = argument("organization-slug").toLowerCase();
const facilityName = argument("facility-name");
const timezone = argument("timezone");
const ownerEmail = argument("owner-email").toLowerCase();
const ownerName = argument("owner-name");
const ownerReference = argument("owner-reference");
const changeTicket = argument("change-ticket") || `provision-${new Date().toISOString()}`;
if (organizationName.length < 2 || organizationName.length > 160) throw new Error("--organization-name must be 2-160 characters.");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organizationSlug)) throw new Error("--organization-slug must be lowercase kebab-case.");
if (facilityName.length < 2 || facilityName.length > 160) throw new Error("--facility-name must be 2-160 characters.");
if (!timezonePattern.test(timezone)) throw new Error("--timezone must be an IANA timezone such as Asia/Jakarta.");
if (!emailPattern.test(ownerEmail)) throw new Error("--owner-email must be a valid email address.");
if (ownerName.length < 2 || ownerName.length > 160) throw new Error("--owner-name must be 2-160 characters.");
if (ownerReference.length < 2 || ownerReference.length > 40) throw new Error("--owner-reference must be 2-40 characters.");

const organizationId = randomUUID();
const facilityId = randomUUID();
const ownerId = randomUUID();
const policyId = randomUUID();
const appointmentTypeId = randomUUID();
const membershipId = randomUUID();
const auditId = randomUUID();
const outboxId = randomUUID();
const correlationId = randomUUID();
const now = new Date().toISOString();
const requestId = `organization-provisioning:${changeTicket}`;
const payload = JSON.stringify({ organizationId, facilityId, ownerId, changeTicket });
const auditNewValues = JSON.stringify({ organizationId, facilityId, ownerId, appointmentType: "FAMILY_VIDEO" });

const sql = `BEGIN IMMEDIATE;
INSERT INTO organizations (id, name, slug, status, version, created_at, updated_at)
VALUES (${sqlLiteral(organizationId)}, ${sqlLiteral(organizationName)}, ${sqlLiteral(organizationSlug)}, 'ACTIVE', 1, ${sqlLiteral(now)}, ${sqlLiteral(now)});
INSERT INTO facilities (id, organization_id, name, timezone, current_state, version, created_at, updated_at)
VALUES (${sqlLiteral(facilityId)}, ${sqlLiteral(organizationId)}, ${sqlLiteral(facilityName)}, ${sqlLiteral(timezone)}, 'NORMAL_OPERATIONS', 1, ${sqlLiteral(now)}, ${sqlLiteral(now)});
INSERT INTO visit_policies (id, organization_id, facility_id, min_duration_minutes, max_duration_minutes, min_advance_minutes, max_advance_days, daily_start_time, daily_end_time, credit_currency, recording_policy, version, created_at, updated_at)
VALUES (${sqlLiteral(policyId)}, ${sqlLiteral(organizationId)}, ${sqlLiteral(facilityId)}, 15, 30, 60, 30, '08:00', '17:00', 'IDR', 'OFF', 1, ${sqlLiteral(now)}, ${sqlLiteral(now)});
INSERT INTO appointment_types (id, organization_id, facility_id, code, display_name, description, duration_minutes, credit_cost, status, version, created_at, updated_at)
VALUES (${sqlLiteral(appointmentTypeId)}, ${sqlLiteral(organizationId)}, ${sqlLiteral(facilityId)}, 'FAMILY_VIDEO', 'Family video visit', 'Standard video visitation appointment.', 30, 1, 'ACTIVE', 1, ${sqlLiteral(now)}, ${sqlLiteral(now)});
INSERT INTO users (id, external_id, email, display_name, user_type, status, version, created_at, updated_at)
VALUES (${sqlLiteral(ownerId)}, ${sqlLiteral(`pending:staff:${ownerId}`)}, ${sqlLiteral(ownerEmail)}, ${sqlLiteral(ownerName)}, 'STAFF', 'ACTIVE', 1, ${sqlLiteral(now)}, ${sqlLiteral(now)});
INSERT INTO staff_profiles (user_id, organization_id, facility_id, employee_reference, job_title, department, created_at, updated_at)
VALUES (${sqlLiteral(ownerId)}, ${sqlLiteral(organizationId)}, ${sqlLiteral(facilityId)}, ${sqlLiteral(ownerReference)}, 'Organization Owner', 'Administration', ${sqlLiteral(now)}, ${sqlLiteral(now)});
INSERT INTO staff_facility_assignments (user_id, organization_id, facility_id, employee_reference, job_title, department, status, assigned_by, version, created_at, updated_at)
VALUES (${sqlLiteral(ownerId)}, ${sqlLiteral(organizationId)}, ${sqlLiteral(facilityId)}, ${sqlLiteral(ownerReference)}, 'Organization Owner', 'Administration', 'ACTIVE', ${sqlLiteral(ownerId)}, 1, ${sqlLiteral(now)}, ${sqlLiteral(now)});
INSERT INTO user_roles (user_id, role_id, organization_id, facility_id, assigned_by, assigned_at)
VALUES (${sqlLiteral(ownerId)}, 'role-supervisor', ${sqlLiteral(organizationId)}, ${sqlLiteral(facilityId)}, ${sqlLiteral(ownerId)}, ${sqlLiteral(now)});
INSERT INTO organization_role_assignments (user_id, organization_id, role_id, status, assigned_by, version, assigned_at, created_at, updated_at)
VALUES (${sqlLiteral(ownerId)}, ${sqlLiteral(organizationId)}, 'role-organization-owner', 'ACTIVE', ${sqlLiteral(ownerId)}, 1, ${sqlLiteral(now)}, ${sqlLiteral(now)}, ${sqlLiteral(now)});
INSERT INTO organization_memberships (id, organization_id, user_id, facility_id, role, status, version, assigned_by, created_at, updated_at)
VALUES (${sqlLiteral(membershipId)}, ${sqlLiteral(organizationId)}, ${sqlLiteral(ownerId)}, ${sqlLiteral(facilityId)}, 'Supervisor', 'ACTIVE', 1, ${sqlLiteral(ownerId)}, ${sqlLiteral(now)}, ${sqlLiteral(now)});
INSERT INTO audit_events (id, organization_id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, old_values, new_values, correlation_id, request_id, created_at)
VALUES (${sqlLiteral(auditId)}, ${sqlLiteral(organizationId)}, ${sqlLiteral(ownerId)}, 'Provisioning Operator', ${sqlLiteral(facilityId)}, 'ORGANIZATION_PROVISIONED', 'organization', ${sqlLiteral(organizationId)}, ${sqlLiteral(`Provisioned under change ticket ${changeTicket}.`)}, NULL, ${sqlLiteral(auditNewValues)}, ${sqlLiteral(correlationId)}, ${sqlLiteral(requestId)}, ${sqlLiteral(now)});
INSERT INTO outbox_events (id, organization_id, event_type, aggregate_type, aggregate_id, facility_id, payload, correlation_id, created_at)
VALUES (${sqlLiteral(outboxId)}, ${sqlLiteral(organizationId)}, 'ORGANIZATION_PROVISIONED', 'organization', ${sqlLiteral(organizationId)}, ${sqlLiteral(facilityId)}, ${sqlLiteral(payload)}, ${sqlLiteral(correlationId)}, ${sqlLiteral(now)});
COMMIT;`;

const configDirectory = path.join(projectRoot, ".wrangler");
const configPath = path.join(configDirectory, `organization-provisioning-${process.pid}.jsonc`);
const sqlPath = path.join(configDirectory, `organization-provisioning-${process.pid}.sql`);
const config = {
  name: "securevisit-organization-provisioning",
  compatibility_date: "2026-09-22",
  d1_databases: [{ binding: "DB", database_name: databaseName, database_id: databaseId, migrations_dir: "../drizzle" }],
};
await mkdir(configDirectory, { recursive: true });
await rm(configPath, { force: true });
await rm(sqlPath, { force: true });
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
await writeFile(sqlPath, `${sql}\n`, { flag: "wx" });
try {
  const wranglerCli = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [wranglerCli, "d1", "execute", "DB", "--remote", "--file", sqlPath, "--config", configPath], { cwd: projectRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) throw new Error(`Organization provisioning failed with exit code ${result.status ?? "unknown"}.`);
  console.log(JSON.stringify({ organizationId, facilityId, ownerId, ownerEmail, appointmentTypeId, correlationId }, null, 2));
} finally {
  await rm(configPath, { force: true });
  await rm(sqlPath, { force: true });
}
