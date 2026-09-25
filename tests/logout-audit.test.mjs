import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/api/auth/logout/route.ts", import.meta.url), "utf8");

test("logout resolves the session owner before revoking the session", () => {
  for (const branch of ["if (sessionToken)", "if (staffSessionToken)"]) {
    const start = source.indexOf(branch);
    assert.notEqual(start, -1, `${branch} branch should exist`);
    const end = source.indexOf("\n    }", start);
    const block = source.slice(start, end === -1 ? source.length : end);
    const lookup = block.indexOf("innerJoin(users, eq(authSessions.userId, users.id))");
    const revoke = block.indexOf("db.update(authSessions).set({ revokedAt:");
    assert.ok(lookup >= 0, `${branch} should resolve the owner for audit`);
    assert.ok(revoke >= 0, `${branch} should revoke the session`);
    assert.ok(lookup < revoke, `${branch} must resolve the owner before revocation`);
  }
});

test("logout retains an audit event for session-authenticated users", () => {
  assert.match(source, /eventType: "LOGOUT_REQUESTED"/);
  assert.match(source, /if \(user\) \{/);
});
