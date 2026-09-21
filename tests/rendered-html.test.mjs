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

async function renderApi(pathname, method = "GET") {
  const worker = await loadWorker();
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { method, headers: { accept: "application/json" } }),
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
  assert.match(html, /Hello, Sarah/);
  assert.match(html, /Your next visit/);
  assert.match(html, /Connections/);
  assert.match(html, /Credits/);
  assert.doesNotMatch(html, /Action center/);
});

test("server-renders the visitor Live Session entry point", async () => {
  const response = await renderPath("/visitor/visits/SV-260814-018/live");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Preparing your secure visit/);
  assert.match(html, /Encrypted media channel/);
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

test("protects kiosk token issuance", async () => {
  const response = await renderApi("/api/kiosk/visits/SV-260814-018/live-session", "POST");
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, "KIOSK_AUTHENTICATION_REQUIRED");
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
});

test("protects staff verification workflow", async () => {
  const response = await renderApi("/api/control/verification");
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
});

test("protects visitor credit and payment workflows", async () => {
  const credits = await renderApi("/api/visitor/credits");
  assert.equal(credits.status, 401);
  assert.equal((await credits.json()).error, "AUTHENTICATION_REQUIRED");

  const payment = await renderApi("/api/visitor/payments", "POST");
  assert.equal(payment.status, 401);
  assert.equal((await payment.json()).error, "AUTHENTICATION_REQUIRED");
});

test("protects visitor notification workflows", async () => {
  const response = await renderApi("/api/visitor/notifications");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "AUTHENTICATION_REQUIRED");
});
