import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../lib/server/payments/process-event.ts", import.meta.url), "utf8");

test("payment webhooks bind to the intent ID before validating provider reference", () => {
  assert.match(source, /const lookupField = payload\.paymentIntentId \? "id" : "provider_reference"/);
  assert.match(source, /WHERE pi\.provider = \? AND pi\.\$\{lookupField\} = \?/);
  assert.match(source, /PAYMENT_PROVIDER_REFERENCE_MISMATCH/);
  assert.doesNotMatch(source, /WHERE provider = \? AND \(id = \? OR provider_reference = \?\)/);
});
