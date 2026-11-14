import assert from "node:assert/strict";
import test from "node:test";
import { requirePlatformProvisioning, SecurityError } from "../lib/server/security.ts";

const originalEnvironment = process.env.SECUREVISIT_ENVIRONMENT;
const originalSecret = process.env.PLATFORM_PROVISIONING_SECRET;

test.after(() => {
  if (originalEnvironment === undefined) delete process.env.SECUREVISIT_ENVIRONMENT;
  else process.env.SECUREVISIT_ENVIRONMENT = originalEnvironment;
  if (originalSecret === undefined) delete process.env.PLATFORM_PROVISIONING_SECRET;
  else process.env.PLATFORM_PROVISIONING_SECRET = originalSecret;
});

test("platform provisioning requires an explicit operator secret and change record", async () => {
  process.env.SECUREVISIT_ENVIRONMENT = "staging";
  process.env.PLATFORM_PROVISIONING_SECRET = "p".repeat(32);
  await assert.rejects(
    requirePlatformProvisioning(new Request("https://securevisit.example.test/api/control/organizations", { headers: { Authorization: "Bearer wrong" } })),
    (error) => error instanceof SecurityError && error.code === "PLATFORM_PROVISIONING_UNAUTHORIZED",
  );
  await assert.rejects(
    requirePlatformProvisioning(new Request("https://securevisit.example.test/api/control/organizations", { headers: { Authorization: `Bearer ${process.env.PLATFORM_PROVISIONING_SECRET}` } })),
    (error) => error instanceof SecurityError && error.code === "ORGANIZATION_PROVISIONING_CONFIRMATION_REQUIRED",
  );
});

test("platform provisioning accepts only the fully attributed operator request", async () => {
  process.env.SECUREVISIT_ENVIRONMENT = "production";
  process.env.PLATFORM_PROVISIONING_SECRET = "p".repeat(32);
  const result = await requirePlatformProvisioning(new Request("https://securevisit.example.test/api/control/organizations", {
    headers: {
      Authorization: `Bearer ${process.env.PLATFORM_PROVISIONING_SECRET}`,
      "X-Confirm-Organization-Provisioning": "yes",
      "X-Operator-Reference": "ops-2026-001",
      "X-Change-Ticket": "CHG-2026-001",
    },
  }));
  assert.deepEqual(result, { operatorReference: "ops-2026-001", changeTicket: "CHG-2026-001" });
});
