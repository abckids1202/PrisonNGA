import test from "node:test";
import assert from "node:assert/strict";
import { isCookieAuthenticatedMutation, isSameOriginMutation } from "../lib/server/csrf.ts";

function request(headers = {}, init = {}) {
  return new Request("https://securevisit.example/api/visitor/profile", {
    method: "POST",
    headers,
    ...init,
  });
}

test("same-origin cookie mutations are allowed", () => {
  const input = request({ cookie: "securevisit_session=session-token", origin: "https://securevisit.example" });
  assert.equal(isCookieAuthenticatedMutation(input), true);
  assert.equal(isSameOriginMutation(input), true);
});

test("cross-origin cookie mutations are rejected", () => {
  const input = request({ cookie: "securevisit_staff_session=staff-token", origin: "https://attacker.example" });
  assert.equal(isSameOriginMutation(input), false);
});

test("same-origin referer is accepted when Origin is absent", () => {
  const input = request({ cookie: "securevisit_session=session-token", referer: "https://securevisit.example/visitor/visits/visit-1" });
  assert.equal(isSameOriginMutation(input), true);
});

test("unauthenticated mutations and federation webhooks are not blocked by the cookie guard", () => {
  assert.equal(isSameOriginMutation(request({}, { method: "POST" })), true);
  const webhook = new Request("https://securevisit.example/api/webhooks/payments", {
    method: "POST",
    headers: { cookie: "securevisit_staff_session=staff-token", origin: "https://provider.example" },
  });
  assert.equal(isSameOriginMutation(webhook), true);
});

test("safe methods do not require an origin", () => {
  const input = request({ cookie: "securevisit_session=session-token" }, { method: "GET" });
  assert.equal(isCookieAuthenticatedMutation(input), false);
  assert.equal(isSameOriginMutation(input), true);
});
