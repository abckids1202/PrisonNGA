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

async function renderApi(pathname) {
  const worker = await loadWorker();
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "application/json" } }),
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
  assert.match(html, /NEXT VISIT/);
  assert.match(html, /Connections/);
  assert.match(html, /Credits/);
  assert.doesNotMatch(html, /Action center/);
});

test("rejects unauthenticated API requests with security headers", async () => {
  const response = await renderApi("/api/auth/me");
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("cache-control"), "no-store");
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
