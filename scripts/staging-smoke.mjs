const baseUrl = String(process.env.STAGING_DOMAIN || "").trim().replace(/\/$/, "");
const readinessCookie = String(process.env.STAGING_READINESS_COOKIE || "").trim();
const requireReadiness = String(process.env.STAGING_SMOKE_REQUIRE_READINESS || "true").toLowerCase() !== "false";
const allowInsecure = String(process.env.STAGING_SMOKE_ALLOW_INSECURE || "false").toLowerCase() === "true";
const timeoutMs = Number(process.env.STAGING_SMOKE_TIMEOUT_MS || 10000);

if (!baseUrl) {
  throw new Error("STAGING_DOMAIN is required, for example https://staging.securevisit.example");
}

let parsedBaseUrl;
try {
  parsedBaseUrl = new URL(baseUrl);
} catch {
  throw new Error(`STAGING_DOMAIN is not a valid URL: ${baseUrl}`);
}

if (!allowInsecure && parsedBaseUrl.protocol !== "https:") {
  throw new Error("STAGING_DOMAIN must use HTTPS; set STAGING_SMOKE_ALLOW_INSECURE=true only for an intentional local check");
}

if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
  throw new Error("STAGING_SMOKE_TIMEOUT_MS must be between 1000 and 60000 milliseconds");
}

const failures = [];
const skipped = [];

function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

function skip(name, detail) {
  skipped.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.warn(`SKIP  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function request(path, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: { accept: "application/json", ...headers },
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function header(response, name) {
  return String(response.headers.get(name) || "").toLowerCase();
}

console.log(`SecureVisit staging smoke: ${baseUrl}`);

let liveResponse;
try {
  liveResponse = await request("/api/health/live");
  const liveBody = await readJson(liveResponse);
  check("liveness status", liveResponse.status === 200 && liveBody?.status === "ok", `HTTP ${liveResponse.status}`);
  check("content type hardening", header(liveResponse, "x-content-type-options") === "nosniff", header(liveResponse, "x-content-type-options") || "missing");
  check("referrer policy", Boolean(header(liveResponse, "referrer-policy")), header(liveResponse, "referrer-policy") || "missing");

  const permissionsPolicy = header(liveResponse, "permissions-policy");
  check("camera permission policy", permissionsPolicy.includes("camera=(self)"), permissionsPolicy || "missing");
  check("microphone permission policy", permissionsPolicy.includes("microphone=(self)"), permissionsPolicy || "missing");

  const csp = header(liveResponse, "content-security-policy");
  check("CSP exists", Boolean(csp), "content-security-policy");
  check("CSP allows same-origin connections", csp.includes("connect-src 'self'"), csp || "missing");
  check("CSP blocks framing", csp.includes("frame-ancestors 'none'"), csp || "missing");
} catch (error) {
  check("liveness request", false, error instanceof Error ? error.message : String(error));
}

if (readinessCookie) {
  const headers = { cookie: readinessCookie };
  try {
    const readinessResponse = await request("/api/health/readiness", headers);
    const readinessBody = await readJson(readinessResponse);
    check("readiness status", readinessResponse.status === 200 && readinessBody?.status === "ready", `HTTP ${readinessResponse.status}`);
    check("readiness schema", readinessBody?.checks?.schema === true, JSON.stringify(readinessBody?.checks?.schema));
    check("readiness providers", Object.values(readinessBody?.checks?.providerConfiguration || {}).every(Boolean), JSON.stringify(readinessBody?.checks?.providerConfiguration || {}));
    check("readiness release gates", readinessBody?.checks?.releaseGates?.ready === true, JSON.stringify(readinessBody?.checks?.releaseGates || {}));
  } catch (error) {
    check("readiness request", false, error instanceof Error ? error.message : String(error));
  }
} else if (requireReadiness) {
  check("readiness credentials", false, "set STAGING_READINESS_COOKIE to a short-lived staff session cookie");
} else {
  skip("authenticated readiness", "set STAGING_SMOKE_REQUIRE_READINESS=true to make this a release gate");
}

if (skipped.length) console.log(`\n${skipped.length} check(s) skipped intentionally.`);
if (failures.length) {
  console.error(`\nStaging smoke failed with ${failures.length} failure(s).`);
  process.exit(1);
}
console.log("\nStaging smoke passed. This validates deployment reachability and configured readiness; it does not replace the full visitor/kiosk/staff acceptance journey.");
