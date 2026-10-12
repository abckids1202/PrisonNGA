import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const forwardedArgs = process.argv.slice(2);
const portFlagIndex = forwardedArgs.findIndex((argument) => argument === "--port" || argument === "-p");
const localPort = portFlagIndex >= 0 && /^\d+$/.test(forwardedArgs[portFlagIndex + 1] || "")
  ? forwardedArgs[portFlagIndex + 1]
  : "5174";

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

// Keep local callback/origin URLs aligned when a developer overrides the
// server port. Never rewrite a non-local URL; production-like values must be
// supplied explicitly and are outside this development convenience.
const configuredPublicUrl = process.env.PUBLIC_APP_URL || "";
try {
  const publicUrl = new URL(configuredPublicUrl);
  if (["localhost", "127.0.0.1", "::1"].includes(publicUrl.hostname)) {
    publicUrl.port = localPort;
    process.env.PUBLIC_APP_URL = publicUrl.toString().replace(/\/$/, "");
  }
} catch {
  // Environment validation reports malformed URLs; do not hide that error.
}

if (process.env.SECUREVISIT_ENVIRONMENT !== "development") {
  throw new Error("dev:local requires SECUREVISIT_ENVIRONMENT=development; refusing to start with staging or production settings.");
}

// Existing checkouts may still have the older LiveKit template in .env.local.
// Use the local persisted transport only when that provider is incomplete;
// preserve a deliberately configured local LiveKit instance.
const liveKitConfigured = Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
if ((process.env.VIDEO_PROVIDER || "").toLowerCase() === "livekit" && !liveKitConfigured) {
  process.env.VIDEO_PROVIDER = "local_test";
  console.log("LiveKit credentials are incomplete; using the development local video transport.");
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
