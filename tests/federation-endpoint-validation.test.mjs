import assert from "node:assert/strict";
import test from "node:test";
import { getOidcConfig } from "../lib/server/auth/oidc.ts";
import { getSamlConfig } from "../lib/server/auth/saml.ts";

function withEnvironment(values, callback) {
  const previous = { ...process.env };
  Object.assign(process.env, values);
  return Promise.resolve(callback()).finally(() => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  });
}

test("OIDC configuration rejects credential-bearing and fragment URLs", async () => {
  await withEnvironment({
    STAFF_OIDC_ISSUER: "https://user:pass@idp.example.test",
    STAFF_OIDC_CLIENT_ID: "client",
    STAFF_OIDC_CLIENT_SECRET: "secret",
    STAFF_OIDC_REDIRECT_URI: "https://control.example.test/callback#fragment",
  }, async () => {
    await assert.rejects(() => getOidcConfig(), /STAFF_OIDC_NOT_CONFIGURED|STAFF_OIDC_REDIRECT_INVALID/);
  });
});

test("SAML configuration rejects unsafe endpoint URLs", async () => {
  await withEnvironment({
    STAFF_SAML_ENTITY_ID: "https://control.example.test/saml",
    STAFF_SAML_METADATA_URL: "https://idp.example.test/metadata#fragment",
    STAFF_SAML_ENTRY_POINT: "https://idp.example.test/login",
    STAFF_SAML_IDP_CERT: "certificate",
    STAFF_SAML_CALLBACK_URI: "https://control.example.test/callback",
  }, async () => {
    await assert.rejects(() => getSamlConfig(), /STAFF_SAML_ENDPOINT_INVALID/);
  });
});
