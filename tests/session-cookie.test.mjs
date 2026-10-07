import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionCookie, clearSessionCookie } from "../lib/server/auth/session-cookie.ts";

test("visitor and staff session cookies share the secure production contract", () => {
  const visitor = buildSessionCookie("securevisit_session", "token with spaces", 604800, true);
  const staff = buildSessionCookie("securevisit_staff_session", "staff-token", 28800, true);
  for (const cookie of [visitor, staff]) {
    assert.match(cookie, /; Path=\//);
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /; SameSite=Lax/);
    assert.match(cookie, /; Secure/);
  }
  assert.match(visitor, /securevisit_session=token%20with%20spaces/);
  assert.match(staff, /Max-Age=28800/);
});

test("local development can clear cookies without emitting Secure on HTTP", () => {
  const cleared = clearSessionCookie("securevisit_session", false);
  assert.match(cleared, /^securevisit_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0$/);
});

test("session cookie helper rejects invalid lifetimes or empty tokens", () => {
  assert.throws(() => buildSessionCookie("securevisit_session", "", 60, true), /SESSION_COOKIE_INPUT_INVALID/);
  assert.throws(() => buildSessionCookie("securevisit_session", "token", -1, true), /SESSION_COOKIE_INPUT_INVALID/);
});
