import assert from "node:assert/strict";
import test from "node:test";
import { parseVisitorProfileInput } from "../lib/server/visitor-profile.ts";

test("visitor profile input is normalized for an active profile", () => {
  assert.deepEqual(parseVisitorProfileInput({ legalName: "  Siti Rahma  ", preferredName: " Siti ", phone: "+628123456789" }), {
    legalName: "Siti Rahma",
    preferredName: "Siti",
    phone: "+628123456789",
  });
});

test("visitor profile input rejects invalid names and non-E.164 phone numbers", () => {
  assert.throws(() => parseVisitorProfileInput({ legalName: "A", phone: "+628123456789" }), /LEGAL_NAME_INVALID/);
  assert.throws(() => parseVisitorProfileInput({ legalName: "Siti Rahma", phone: "08123456789" }), /PHONE_FORMAT_INVALID/);
  assert.throws(() => parseVisitorProfileInput({ legalName: "Siti Rahma", preferredName: "x".repeat(121) }), /PREFERRED_NAME_INVALID/);
});
