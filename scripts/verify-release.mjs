import { spawnSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const checks = [
  ["working-tree patch validation", ["diff", "--check"], "git"],
  ["fresh local D1 migrations", ["run", "db:test:migrations:local"]],
  ["typecheck", ["run", "typecheck"]],
  ["lint", ["run", "lint"]],
  ["build and server tests", ["test"]],
  ["browser tests", ["run", "test:e2e"]],
  ["production dependency audit", ["audit", "--omit=dev", "--audit-level=high"]],
];

console.log("SecureVisit release verification");
console.log("This command validates the local release baseline only; it does not deploy or mutate a remote database.\n");

for (const [label, args] of checks) {
  console.log(`▶ ${label}`);
  // Windows exposes npm as a command script rather than a native executable.
  // The arguments are fixed above, so enabling the platform shell here only
  // handles command resolution and does not interpolate user input.
  const command = checks.find(([candidate]) => candidate === label)?.[2] === "git" ? "git" : npmCommand;
  const environment = label === "browser tests"
    ? { ...process.env, SECUREVISIT_E2E_ISOLATED: "true" }
    : process.env;
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32", env: environment });
  if (result.error) {
    console.error(`✖ ${label}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`✖ ${label} failed with exit code ${result.status ?? "unknown"}`);
    process.exit(result.status || 1);
  }
  console.log(`✓ ${label}\n`);
}

console.log("Release verification passed. External provider, staging, security, resilience, and institutional approval gates still require their own evidence.");
