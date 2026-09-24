import { validateEnvironment } from "../lib/server/config.ts";

// The Worker supplies DB as a binding. The CLI only needs a presence marker;
// it must not connect to or print database credentials during validation.
const check = validateEnvironment({ ...process.env, DB: {} });

const result = {
  environment: check.environment,
  ok: check.ok,
  missing: check.missing,
  warnings: check.warnings,
};

console.log(JSON.stringify(result, null, 2));

if (!check.ok) process.exitCode = 1;
