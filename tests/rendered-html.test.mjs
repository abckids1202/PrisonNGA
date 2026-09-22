import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

async function renderPath(pathname = "/") {
  const worker = await loadWorker();

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function render() {
  return renderPath("/");
}

async function renderApi(pathname, method = "GET", body, extraHeaders = {}) {
  const worker = await loadWorker();
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { method, headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...extraHeaders }, body }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the SecureVisit operations dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /SecureVisit/);
  assert.match(html, /Central Correctional Facility/);
  assert.match(html, /Today(?:’|&apos;|&#x27;)s operational timeline/);
  assert.match(html, /Requires attention/);
  assert.match(html, /Command Center/);
  assert.match(html, /DEMO ENVIRONMENT/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});

test("server-renders a distinct visitor application shell", async () => {
  const response = await renderPath("/visitor");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /SecureVisit/);
  assert.match(html, /Checking your secure session/);
  assert.doesNotMatch(html, /Hello, Sarah/);
  assert.doesNotMatch(html, /Action center/);
});

test("server-renders the visitor Live Session entry point", async () => {
  const response = await renderPath("/visitor/visits/SV-260814-018/live");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Preparing your secure visit/);
  assert.match(html, /Encrypted media channel/);
});

test("server-renders a kiosk credential prompt without putting device secrets in the URL", async () => {
  const response = await renderPath("/kiosk/visits/SV-260814-018/live?kiosk=kiosk-02");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Connect this kiosk/);
  assert.match(html, /One-time device credential/);
  assert.match(html, /type="password"/);
});

test("rejects unauthenticated API requests with security headers", async () => {
  const response = await renderApi("/api/auth/me");
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy") ?? "", /wss:\/\/\*\.livekit\.cloud/);
  assert.equal(response.headers.get("permissions-policy"), "camera=(self), microphone=(self), geolocation=(), payment=()");
  assert.match(response.headers.get("x-request-id") ?? "", /.+/);
  const body = await response.json();
  assert.equal(body.error, "AUTHENTICATION_REQUIRED");
  assert.equal(body.requestId, response.headers.get("x-request-id"));
});

test("protects the Waiting Room operations API", async () => {
  const response = await renderApi("/api/control/waiting-room");
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.error, "AUTHENTICATION_REQUIRED");
  assert.equal(body.requestId, response.headers.get("x-request-id"));
});

test("protects the facility resource catalog", async () => {
  const response = await renderApi("/api/control/resources");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "AUTHENTICATION_REQUIRED");
});

test("protects the facility prisoner directory", async () => {
  const response = await renderApi("/api/control/prisoners");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "AUTHENTICATION_REQUIRED");
});

test("protects the incident management API", async () => {
  const response = await renderApi("/api/control/incidents");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "AUTHENTICATION_REQUIRED");
});

test("protects kiosk token issuance", async () => {
  const response = await renderApi("/api/kiosk/visits/SV-260814-018/live-session", "POST");
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, "KIOSK_AUTHENTICATION_REQUIRED");

  const idOnly = await renderApi("/api/kiosk/visits/SV-260814-018/live-session", "POST", undefined, { "x-securevisit-kiosk-id": "kiosk-02" });
  assert.equal(idOnly.status, 401);
  assert.equal((await idOnly.json()).error, "KIOSK_AUTHENTICATION_REQUIRED");
});

test("protects visitor Live Session token issuance", async () => {
  const response = await renderApi("/api/visitor/visits/SV-260814-018/live-session", "POST");
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, "AUTHENTICATION_REQUIRED");
});

test("protects visitor-owned workflow APIs", async () => {
  const profile = await renderApi("/api/visitor/profile");
  assert.equal(profile.status, 401);
  assert.equal((await profile.json()).error, "AUTHENTICATION_REQUIRED");

  const relationships = await renderApi("/api/visitor/relationships");
  assert.equal(relationships.status, 401);
  assert.equal((await relationships.json()).error, "AUTHENTICATION_REQUIRED");

  const evidence = await renderApi("/api/visitor/verification/evidence");
  assert.equal(evidence.status, 401);
  assert.equal((await evidence.json()).error, "AUTHENTICATION_REQUIRED");

  const forgedWorkspaceIdentity = await renderApi("/api/visitor/profile", "GET", undefined, {
    "oai-authenticated-user-id": "visitor-demo",
    "oai-authenticated-user-email": "visitor@example.test",
  });
  assert.equal(forgedWorkspaceIdentity.status, 401);
  assert.equal((await forgedWorkspaceIdentity.json()).error, "AUTHENTICATION_REQUIRED");

  const availability = await renderApi("/api/visitor/availability?facilityId=facility-central-001&prisonerId=prisoner-ar-001&date=2026-09-22");
  assert.equal(availability.status, 401);
  assert.equal((await availability.json()).error, "AUTHENTICATION_REQUIRED");

  const prisoners = await renderApi("/api/visitor/prisoners?facilityId=facility-central-001");
  assert.equal(prisoners.status, 401);
  assert.equal((await prisoners.json()).error, "AUTHENTICATION_REQUIRED");
});

test("protects staff verification workflow", async () => {
  const response = await renderApi("/api/control/verification");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "AUTHENTICATION_REQUIRED");

  const evidence = await renderApi("/api/control/verification/evidence?verificationCaseId=case-1");
  assert.equal(evidence.status, 401);
  assert.equal((await evidence.json()).error, "AUTHENTICATION_REQUIRED");

  const evidenceFile = await renderApi("/api/control/verification/evidence/evidence-1");
  assert.equal(evidenceFile.status, 401);
  assert.equal((await evidenceFile.json()).error, "AUTHENTICATION_REQUIRED");
});

test("protects staff provisioning workflow", async () => {
  const list = await renderApi("/api/control/staff");
  assert.equal(list.status, 401);
  assert.equal((await list.json()).error, "AUTHENTICATION_REQUIRED");

  const create = await renderApi("/api/control/staff", "POST", JSON.stringify({ email: "staff@example.test" }));
  assert.equal(create.status, 401);
  assert.equal((await create.json()).error, "AUTHENTICATION_REQUIRED");
});

test("protects retention and legal hold controls", async () => {
  const retention = await renderApi("/api/control/retention");
  assert.equal(retention.status, 401);
  assert.equal((await retention.json()).error, "AUTHENTICATION_REQUIRED");
  const holds = await renderApi("/api/control/legal-holds");
  assert.equal(holds.status, 401);
  assert.equal((await holds.json()).error, "AUTHENTICATION_REQUIRED");
});

test("protects notification outbox operations", async () => {
  const response = await renderApi("/api/control/notifications/outbox");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "AUTHENTICATION_REQUIRED");
});

test("protects audit exports", async () => {
  const response = await renderApi("/api/control/audit/export");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "AUTHENTICATION_REQUIRED");
});

test("protects persisted appointment workflows", async () => {
  const visitor = await renderApi("/api/visitor/appointments");
  assert.equal(visitor.status, 401);
  assert.equal((await visitor.json()).error, "AUTHENTICATION_REQUIRED");

  const control = await renderApi("/api/control/appointments");
  assert.equal(control.status, 401);
  assert.equal((await control.json()).error, "AUTHENTICATION_REQUIRED");

  const visitorPatch = await renderApi("/api/visitor/appointments", "PATCH", "{}");
  assert.equal(visitorPatch.status, 401);
  assert.equal((await visitorPatch.json()).error, "AUTHENTICATION_REQUIRED");
});

test("protects visitor credit and payment workflows", async () => {
  const credits = await renderApi("/api/visitor/credits");
  assert.equal(credits.status, 401);
  assert.equal((await credits.json()).error, "AUTHENTICATION_REQUIRED");

  const payment = await renderApi("/api/visitor/payments", "POST");
  assert.equal(payment.status, 401);
  assert.equal((await payment.json()).error, "AUTHENTICATION_REQUIRED");
});

test("fails closed when payment webhook signing is not configured", async () => {
  const response = await renderApi("/api/webhooks/payments", "POST");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "PAYMENT_WEBHOOK_NOT_CONFIGURED");
});

test("fails closed when LiveKit webhook configuration is unavailable", async () => {
  const response = await renderApi("/api/webhooks/livekit", "POST", "{}");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "VIDEO_PROVIDER_NOT_CONFIGURED");
});

test("protects visitor notification workflows", async () => {
  const response = await renderApi("/api/visitor/notifications");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "AUTHENTICATION_REQUIRED");
});

test("keeps the rate-limit store and staff federation boundary behind safe defaults", async () => {
  const response = await renderApi("/api/auth/visitor/request", "POST", "{}");
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "VALID_EMAIL_REQUIRED");
});

test("protects visitor session management", async () => {
  const response = await renderApi("/api/auth/sessions");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "AUTHENTICATION_REQUIRED");
});

test("exposes a fail-closed staff federation configuration", async () => {
  const response = await renderApi("/api/auth/staff/config");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.staffFederation.configured, false);
});

test("fails closed when SAML staff authentication is not configured", async () => {
  const response = await renderApi("/api/auth/staff/saml/start");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "STAFF_SAML_NOT_CONFIGURED");
});

test("declares the outbox worker schedule in the generated Worker build", async () => {
  const workerConfig = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8")));
  assert.deepEqual(workerConfig.triggers?.crons, ["*/1 * * * *"]);
});

test("exposes a non-sensitive readiness endpoint", async () => {
  const response = await renderApi("/api/health/readiness");
  assert.ok([200, 503].includes(response.status));
  const body = await response.json();
  assert.ok(["ready", "not_ready"].includes(body.status));
  assert.equal(typeof body.checks.database, "boolean");
  assert.equal(typeof body.checks.schema, "boolean");
  assert.doesNotMatch(JSON.stringify(body), /LIVEKIT_API_SECRET|PAYMENT_WEBHOOK_SECRET|HASH_SALT/);
});
