import assert from "node:assert/strict";
import test from "node:test";
import { assertRequestBodyWithinLimit, readTextBodyWithinLimit } from "../lib/server/request-body.ts";

test("bounded request assertion checks streamed bodies without consuming the original", async () => {
  const request = new Request("https://securevisit.test/api/test", { method: "POST", body: JSON.stringify({ ok: true }) });
  await assertRequestBodyWithinLimit(request, 128);
  assert.deepEqual(await request.json(), { ok: true });
});

test("bounded request assertion rejects a streamed body after the limit is crossed", async () => {
  const request = new Request("https://securevisit.test/api/test", { method: "POST", body: "x".repeat(129) });
  await assert.rejects(() => assertRequestBodyWithinLimit(request, 128), /REQUEST_BODY_TOO_LARGE/);
});

test("bounded request reader accepts bodies within the byte limit", async () => {
  const body = await readTextBodyWithinLimit(new Request("https://securevisit.test", { method: "POST", body: "hello" }), 5);
  assert.equal(body, "hello");
});

test("bounded request reader rejects declared bodies before reading them", async () => {
  await assert.rejects(
    () => readTextBodyWithinLimit(new Request("https://securevisit.test", { method: "POST", headers: { "content-length": "999" }, body: "hello" }), 5),
    (error) => error?.code === "REQUEST_BODY_TOO_LARGE" && error?.statusCode === 413,
  );
});

test("bounded request reader rejects actual UTF-8 bodies above the limit", async () => {
  await assert.rejects(
    () => readTextBodyWithinLimit(new Request("https://securevisit.test", { method: "POST", body: "🙂🙂" }), 4),
    (error) => error?.code === "REQUEST_BODY_TOO_LARGE" && error?.statusCode === 413,
  );
});
