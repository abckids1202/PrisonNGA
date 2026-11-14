import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdtemp, readFile as readTextFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = "scripts/staging-smoke.mjs";

test("staging smoke is scheduled for public monitoring and keeps authenticated readiness manual", async () => {
  const workflow = await readFile(".github/workflows/staging-smoke.yml", "utf8");
  assert.match(workflow, /schedule:[\s\S]*- cron: ["']\*\/15 \* \* \* \*["']/);
  assert.match(workflow, /STAGING_SMOKE_REQUIRE_READINESS: \$\{\{ github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /STAGING_SMOKE_EVIDENCE_PATH: evidence\/staging-smoke-\$\{\{ github\.run_id \}\}\.json/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /if-no-files-found: error/);
});

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

function startServer({ secureHeaders = true, livekit = true } = {}) {
  const server = createServer((request, response) => {
    if (secureHeaders) {
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      response.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=()");
      response.setHeader("Content-Security-Policy", livekit
        ? "default-src 'self'; frame-ancestors 'none'; connect-src 'self' https://*.livekit.cloud wss://*.livekit.cloud https://*.livekit.io wss://*.livekit.io"
        : "default-src 'self'; frame-ancestors 'none'; connect-src 'self'");
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

test("staging smoke can write a redacted evidence artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "securevisit-smoke-"));
  const evidencePath = join(directory, "evidence", "smoke.json");
  const { server, baseUrl } = await startServer();
  try {
    const result = await runSmoke(baseUrl, { STAGING_SMOKE_EVIDENCE_PATH: evidencePath, SECUREVISIT_RELEASE_EVIDENCE_ID: "release-test-001" });
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    const evidence = JSON.parse(await readTextFile(evidencePath, "utf8"));
    assert.equal(evidence.environment, "staging");
    assert.equal(evidence.releaseId, "release-test-001");
    assert.equal(evidence.readinessChecked, false);
    assert.ok(evidence.checks.some((check) => check.name === "liveness status" && check.status === "PASS"));
    assert.doesNotMatch(JSON.stringify(evidence), /securevisit_staff_session|readiness-cookie|secret/i);
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
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

test("staging smoke fails when LiveKit connections are blocked by CSP", async () => {
  const { server, baseUrl } = await startServer({ livekit: false });
  try {
    const result = await runSmoke(baseUrl);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /LiveKit Cloud connections/);
  } finally {
    server.close();
  }
});
