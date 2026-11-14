import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateReleaseGates } from "../lib/server/release-gates.ts";

function option(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : "";
}

export async function validateReleaseEvidence({ environment, manifestPath, env = process.env } = {}) {
  const targetEnvironment = String(environment || env.SECUREVISIT_ENVIRONMENT || "").trim().toLowerCase();
  const values = { ...env };
  if (manifestPath) values[targetEnvironment === "staging" ? "SECUREVISIT_STAGING_EVIDENCE_MANIFEST" : "SECUREVISIT_RELEASE_EVIDENCE_MANIFEST"] = await readFile(resolve(manifestPath), "utf8");
  const result = evaluateReleaseGates(targetEnvironment, values);
  return { environment: targetEnvironment, manifestPath: manifestPath ? resolve(manifestPath) : null, ...result };
}

export async function main() {
  const result = await validateReleaseEvidence({ environment: option("environment"), manifestPath: option("manifest") || null });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
