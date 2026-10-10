import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PLACEHOLDER_D1_ID = "00000000-0000-4000-8000-000000000000";
const D1_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function option(name) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length).trim() : "";
}

function binding(config, collection, binding) {
  return Array.isArray(config?.[collection])
    ? config[collection].find((item) => item && item.binding === binding)
    : null;
}

export function evaluateDeploymentConfig(config, environment, runtime = {}) {
  const failures = [];
  const warnings = [];
  const vars = config?.vars && typeof config.vars === "object" ? config.vars : {};
  const d1 = binding(config, "d1_databases", "DB");
  const evidence = binding(config, "r2_buckets", "EVIDENCE_BUCKET");
  const queueName = String(runtime.NOTIFICATION_QUEUE_NAME || "").trim();
  const queueProducer = Array.isArray(config?.queues?.producers)
    ? config.queues.producers.find((item) => item?.binding === "NOTIFICATION_QUEUE")
    : null;
  const queueConsumer = Array.isArray(config?.queues?.consumers)
    ? config.queues.consumers.find((item) => item?.queue === queueName)
    : null;
  const cronConfigured = Array.isArray(config?.triggers?.crons) && config.triggers.crons.includes("*/1 * * * *");

  if (!["staging", "production"].includes(environment)) failures.push("--environment must be staging or production");
  if (vars.SECUREVISIT_ENVIRONMENT !== environment) failures.push(`generated SECUREVISIT_ENVIRONMENT must be ${environment}`);
  for (const [key, value] of Object.entries(vars)) {
    if (["console", "local_test", "in_app"].includes(String(value).trim().toLowerCase())) {
      failures.push(`generated ${key} must not use development adapter ${value}`);
    }
  }
  if (!d1) failures.push("generated DB D1 binding is missing");
  else if (!D1_UUID.test(String(d1.database_id || "")) || d1.database_id === PLACEHOLDER_D1_ID) failures.push("generated DB D1 binding must use a real database UUID");
  if (!evidence) failures.push("generated EVIDENCE_BUCKET R2 binding is missing");
  if (!cronConfigured) failures.push("generated scheduled trigger */1 * * * * is missing");
  if (!queueName) failures.push("NOTIFICATION_QUEUE_NAME is required for staging and production");
  else if (!queueProducer || !queueConsumer) failures.push("NOTIFICATION_QUEUE_NAME is set but the generated queue binding is incomplete");
  return { ok: failures.length === 0, failures, warnings };
}

export async function runDeploymentPreflight() {
  const environment = option("environment") || String(process.env.SECUREVISIT_ENVIRONMENT || "").trim();
  const configPath = resolve(process.env.DEPLOYMENT_CONFIG_PATH || "dist/server/wrangler.json");
  try {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const result = evaluateDeploymentConfig(config, environment, process.env);
    console.log(JSON.stringify({ configPath, environment, ...result }, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Deployment preflight could not read ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runDeploymentPreflight();
}
