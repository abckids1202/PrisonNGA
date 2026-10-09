import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";

const script = "scripts/staging-smoke.mjs";

function runSmoke(baseUrl, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        STAGING_DOMAIN: baseUrl,
        STAGING_SMOKE_ALLOW_INSECURE: "true",
        STAGING_SMOKE_REQUIRE_READINESS: "false",
        ...extra,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function startServer({ secureHeaders = true } = {}) {
  const server = createServer((request, response) => {
    if (secureHeaders) {
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      response.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=()");
      response.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; connect-src 'self' wss://*.livekit.cloud");
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ status: "ok" }));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
  }));
}

test("staging smoke passes the public deployment contract", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const result = await runSmoke(baseUrl);
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Staging smoke passed/);
    assert.match(result.stderr, /SKIP  authenticated readiness/);
  } finally {
    server.close();
  }
});

test("staging smoke fails when required security headers are missing", async () => {
  const { server, baseUrl } = await startServer({ secureHeaders: false });
  try {
    const result = await runSmoke(baseUrl);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Staging smoke failed/);
    assert.match(result.stderr, /camera permission policy/);
  } finally {
    server.close();
  }
});
