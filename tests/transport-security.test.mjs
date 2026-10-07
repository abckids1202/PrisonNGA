import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

test("production HTTPS responses opt into HSTS while local development remains HTTP-safe", () => {
  assert.match(worker, /function applyTransportSecurityHeader\(response: Response, request: Request, environment: string\)/);
  assert.match(worker, /environment !== "development" && new URL\(request\.url\)\.protocol === "https:"/);
  assert.match(worker, /Strict-Transport-Security.*max-age=31536000; includeSubDomains/);
  assert.match(worker, /applyTransportSecurityHeader\(securedResponse, request, environmentCheck\.environment\)/);
});
