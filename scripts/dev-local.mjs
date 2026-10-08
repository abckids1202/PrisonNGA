import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const forwardedArgs = process.argv.slice(2);
const portFlagIndex = forwardedArgs.findIndex((argument) => argument === "--port" || argument === "-p");
const localPort = portFlagIndex >= 0 && /^\d+$/.test(forwardedArgs[portFlagIndex + 1] || "")
  ? forwardedArgs[portFlagIndex + 1]
  : "5173";

if (!existsSync(".env.local") || statSync(".env.local").size === 0) {
  copyFileSync(".env.example", ".env.local");
  console.log("Created .env.local from .env.example for local development.");
}

// The Cloudflare/Vinext worker receives bindings from the parent process.
// Load the local file here so `npm run dev:local` behaves the same on a fresh
// checkout as an explicitly env-filed command, without adding a dotenv runtime
// dependency or exposing values in logs.
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
  if (!match || match[1] in process.env) continue;
  const rawValue = match[2].trim();
  process.env[match[1]] = rawValue.startsWith("\"") && rawValue.endsWith("\"")
    ? rawValue.slice(1, -1)
    : rawValue;
}

if (process.env.SECUREVISIT_ENVIRONMENT !== "development") {
  throw new Error("dev:local requires SECUREVISIT_ENVIRONMENT=development; refusing to start with staging or production settings.");
}

function runScript(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, ["run", script, ...(args.length ? ["--", ...args] : [])], {
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) return reject(new Error(`${script} stopped with ${signal}`));
      if (code !== 0) return reject(new Error(`${script} exited with code ${code}`));
      resolve();
    });
  });
}

try {
  await runScript("db:migrate:local");
  await runScript("db:seed:local");
  console.log(`SecureVisit local development server: http://localhost:${localPort}`);
  console.log(`Visitor: http://localhost:${localPort}/visitor · Control: http://localhost:${localPort}/control · Kiosk: http://localhost:${localPort}/kiosk`);
  await runScript("dev", forwardedArgs);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
