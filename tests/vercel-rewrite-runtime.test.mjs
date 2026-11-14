import assert from "node:assert/strict";
import { test } from "node:test";

async function loadConfig(workerOrigin) {
  const previous = process.env.WORKER_API_ORIGIN;
  if (workerOrigin === undefined) delete process.env.WORKER_API_ORIGIN;
  else process.env.WORKER_API_ORIGIN = workerOrigin;
  try {
    const configModule = await import(`../next.config.ts?rewrite-test=${encodeURIComponent(workerOrigin || "unset")}-${Date.now()}-${Math.random()}`);
    return await configModule.default.rewrites();
  } finally {
    if (previous === undefined) delete process.env.WORKER_API_ORIGIN;
    else process.env.WORKER_API_ORIGIN = previous;
  }
}

test("Vercel rewrite targets the configured Worker origin", async () => {
  assert.deepEqual(await loadConfig("https://api.staging.securevisit.example"), [{ source: "/api/:path*", destination: "https://api.staging.securevisit.example/api/:path*" }]);
});

test("invalid Worker origins fail closed to no rewrite", async () => {
  assert.deepEqual(await loadConfig("http://localhost:8787"), []);
});

test("local development has no external API rewrite", async () => {
  assert.deepEqual(await loadConfig(undefined), []);
});
