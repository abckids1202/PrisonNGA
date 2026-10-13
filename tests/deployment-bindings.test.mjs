import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deployment build reads explicit remote D1 and R2 binding configuration", async () => {
  const source = await readFile("vite.config.ts", "utf8");
  assert.match(source, /deploymentEnvironmentValue\("D1_DATABASE_ID"\)/);
  assert.match(source, /deploymentEnvironmentValue\("D1_DATABASE_NAME"\)/);
  assert.match(source, /deploymentEnvironmentValue\("EVIDENCE_BUCKET_NAME"\)/);
  assert.match(source, /database_id: configuredD1DatabaseId \|\| SITE_CREATOR_PLACEHOLDER_DATABASE_ID/);
  assert.match(source, /binding: r2 \|\| "EVIDENCE_BUCKET"/);
  assert.match(source, /A non-development build must never inherit adapter or resource values/);
  assert.match(source, /const deploymentEnvironmentValue = \(key: string\)/);
  assert.match(source, /const runtimeConfigKeys = \[/);
  assert.match(source, /"PUBLIC_APP_URL"/);
  assert.match(source, /"NOTIFICATION_QUEUE_NAME"/);
  assert.match(source, /"EVIDENCE_SCAN_PROVIDER"/);
  assert.match(source, /"STAFF_OIDC_ISSUER"/);
  assert.match(source, /const nonSecretDeploymentKeys = \[/);
  assert.match(source, /local adapters cannot be[\s\S]*?merged into staging[\s\S]*?production/);
  assert.match(source, /signing material remain Cloudflare secret bindings/);
});

test("package scripts expose environment-specific dry-run gates", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(packageJson.scripts["deploy:staging:dry-run"], /validate:deployment -- --environment=staging/);
  assert.match(packageJson.scripts["deploy:production:dry-run"], /validate:deployment -- --environment=production/);
});
