import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

test("production HTTPS responses opt into HSTS while local development remains HTTP-safe", () => {
  assert.match(worker, /function applyTransportSecurityHeader\(response: Response, request: Request, environment: string\)/);
  assert.match(worker, /function applyWorkerSecurityHeaders\(response: Response, request: Request, env: Env, environment: string, requestId: string\)/);
  assert.match(worker, /environment !== "development" && new URL\(request\.url\)\.protocol === "https:"/);
  assert.match(worker, /Strict-Transport-Security.*max-age=31536000; includeSubDomains/);
  assert.match(worker, /applyWorkerSecurityHeaders\(securedResponse, routedRequest, env, environmentCheck\.environment, requestId\)/);
});

test("edge rejection and image responses retain the same browser security policy", () => {
  assert.match(worker, /applyWorkerSecurityHeaders\(response, routedRequest, env, environmentCheck\.environment, requestId\)/);
  assert.match(worker, /applyWorkerSecurityHeaders\(securedImageResponse, routedRequest, env, environmentCheck\.environment, requestId\)/);
  assert.match(worker, /Content-Security-Policy/);
  assert.match(worker, /Permissions-Policy/);
  assert.match(worker, /liveKitConnectSources\(env\)/);
});

test("health probes remain routable while application traffic fails closed", () => {
  assert.match(worker, /const isHealthProbe = request\.method === "GET" && \(url\.pathname === "\/api\/health\/live" \|\| url\.pathname === "\/api\/health\/readiness"\)/);
  assert.match(worker, /if \(!isHealthProbe && \(environmentCheck\.environment === "invalid"/);
});

test("rate-limit responses provide bounded retry guidance", async () => {
  const security = await readFile(new URL("../lib/server/security.ts", import.meta.url), "utf8");
  assert.match(security, /response\.headers\.set\("Retry-After", String\(retryAfter\)\)/);
  assert.match(security, /case "AUTH_RETRY_TOO_SOON": return 60/);
  assert.match(security, /case "AUTH_RATE_LIMITED": return 900/);
  assert.match(security, /case "RATE_LIMITED": return 60/);
});
