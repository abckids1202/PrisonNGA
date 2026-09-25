import { expect, test } from "@playwright/test";
import { createHmac } from "node:crypto";

const testOrigin = `http://localhost:${process.env.PLAYWRIGHT_PORT || "4173"}`;

test("control workspace renders its operational shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("SecureVisit Control").first()).toBeVisible();
  await expect(page.getByText("Command Center", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("DEVELOPMENT ENVIRONMENT", { exact: true })).toBeVisible();
});

test("visitor workspace is a separate authenticated boundary", async ({ page }) => {
  await page.goto("/visitor");

  await expect(page.getByText("SECUREVISIT VISITOR", { exact: true })).toBeVisible();
  await expect(page.getByText("Sign in with a one-time code to manage visits and connections.")).toBeVisible();
  await expect(page.getByText("Action center", { exact: true })).toHaveCount(0);
});

test("visitor workspace subroutes open the requested persisted section", async ({ page }) => {
  const email = `routes-${Date.now()}@example.test`;
  const requestCode = await page.request.post("/api/auth/visitor/request", { data: { email } });
  expect(requestCode.status()).toBe(201);
  const challenge = await requestCode.json() as { challengeId?: string; devCode?: string };
  const verify = await page.request.post("/api/auth/visitor/verify", { data: { challengeId: challenge.challengeId, code: challenge.devCode, displayName: "Route Visitor" } });
  expect(verify.status()).toBe(200);

  await page.goto("/visitor/visits");
  await expect(page.getByRole("heading", { name: "Time together, made simple." })).toBeVisible();
  await page.goto("/visitor/connections");
  await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
  await page.goto("/visitor/credits");
  await expect(page.getByRole("heading", { name: "Keep your visits going." })).toBeVisible();
});

test("visitor can complete the development OTP flow through the sign-in form", async ({ page }) => {
  const email = `form-${Date.now()}@example.test`;
  await page.goto("/visitor");

  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Your name").fill("Form Visitor");
  const requestPromise = page.waitForResponse((response) => response.url().endsWith("/api/auth/visitor/request") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Send me a sign-in code" }).click();
  const requestResponse = await requestPromise;
  expect(requestResponse.status()).toBe(201);
  const challenge = await requestResponse.json() as { challengeId?: string; devCode?: string };
  expect(challenge.challengeId).toBeTruthy();
  expect(challenge.devCode).toMatch(/^\d{6}$/);

  await page.getByLabel("Six-digit code").fill(challenge.devCode || "");
  const verifyPromise = page.waitForResponse((response) => response.url().endsWith("/api/auth/visitor/verify") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Continue to SecureVisit" }).click();
  const verifyResponse = await verifyPromise;
  expect(verifyResponse.status()).toBe(200);
  await expect(page.getByText("Hello, Form Visitor")).toBeVisible();
  await expect(page.getByText("Your visitor account", { exact: true })).toBeVisible();
});

test("development visitor OTP creates a real browser session", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;
  const ipAddress = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const requestCode = await page.request.post("/api/auth/visitor/request", { headers: { "cf-connecting-ip": ipAddress }, data: { email } });
  expect(requestCode.status()).toBe(201);
  const challenge = await requestCode.json() as { challengeId?: string; devCode?: string };
  expect(challenge.challengeId).toBeTruthy();
  expect(challenge.devCode).toMatch(/^\d{6}$/);

  const verify = await page.request.post("/api/auth/visitor/verify", { headers: { "cf-connecting-ip": ipAddress }, data: { challengeId: challenge.challengeId, code: challenge.devCode, displayName: "Browser Visitor" } });
  expect(verify.status()).toBe(200);
  await expect(verify.json()).resolves.toMatchObject({ authenticated: true, visitor: { displayName: "Browser Visitor" } });

  await page.goto("/visitor");
  await expect(page.getByText("Hello, Browser Visitor")).toBeVisible();
  await expect(page.getByText("Your visitor account", { exact: true })).toBeVisible();
});

test("development visitor SMS OTP creates a real browser session", async ({ page }) => {
  const phone = `+62812${String(Date.now()).slice(-8)}`;
  const ipAddress = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const requestCode = await page.request.post("/api/auth/visitor/request", { headers: { "cf-connecting-ip": ipAddress }, data: { channel: "SMS", phone } });
  expect(requestCode.status()).toBe(201);
  const challenge = await requestCode.json() as { challengeId?: string; channel?: string; destination?: string; devCode?: string };
  expect(challenge.channel).toBe("SMS");
  expect(challenge.destination).toMatch(/^\+62••••\d{2}$/);
  expect(challenge.devCode).toMatch(/^\d{6}$/);

  const verify = await page.request.post("/api/auth/visitor/verify", { headers: { "cf-connecting-ip": ipAddress }, data: { challengeId: challenge.challengeId, code: challenge.devCode, displayName: "SMS Browser Visitor" } });
  expect(verify.status()).toBe(200);
  await expect(verify.json()).resolves.toMatchObject({ authenticated: true, visitor: { displayName: "SMS Browser Visitor", phone } });
});

test("visitor credit purchase is settled only by the signed webhook and is duplicate-safe", async ({ page }) => {
  const email = `payment-${Date.now()}@example.test`;
  const requestCode = await page.request.post("/api/auth/visitor/request", { data: { email } });
  expect(requestCode.status()).toBe(201);
  const challenge = await requestCode.json() as { challengeId?: string; devCode?: string };
  const verify = await page.request.post("/api/auth/visitor/verify", { data: { challengeId: challenge.challengeId, code: challenge.devCode, displayName: "Payment Visitor" } });
  expect(verify.status()).toBe(200);

  const payment = await page.request.post("/api/visitor/payments", {
    headers: { origin: testOrigin, "Idempotency-Key": `payment-e2e-${Date.now()}` },
    data: { facilityId: "facility-central-001", creditQuantity: 1 },
  });
  expect(payment.status(), await payment.text()).toBe(201);
  const paymentBody = await payment.json() as { paymentIntent?: { id: string; amountMinor: number; currency: string }; };
  expect(paymentBody.paymentIntent?.id).toBeTruthy();
  expect(paymentBody.paymentIntent?.amountMinor).toBe(50000);

  const payload = JSON.stringify({
    eventId: `evt-${Date.now()}`,
    eventType: "PAYMENT_SUCCEEDED",
    paymentIntentId: paymentBody.paymentIntent?.id,
    providerReference: `local-payment-${paymentBody.paymentIntent?.id}`,
    status: "SUCCEEDED",
    amountMinor: paymentBody.paymentIntent?.amountMinor,
    currency: paymentBody.paymentIntent?.currency,
  });
  const signature = createHmac("sha256", "local-e2e-payment-secret").update(payload).digest("hex");
  const webhookHeaders = { "content-type": "application/json", "x-payment-provider": "local_test", "x-securevisit-signature": `sha256=${signature}` };
  const firstWebhook = await page.request.post("/api/webhooks/payments", { headers: webhookHeaders, data: payload });
  expect(firstWebhook.status()).toBe(200);
  await expect(firstWebhook.json()).resolves.toMatchObject({ accepted: true, status: "SUCCEEDED" });
  const duplicateWebhook = await page.request.post("/api/webhooks/payments", { headers: webhookHeaders, data: payload });
  expect(duplicateWebhook.status()).toBe(200);
  await expect(duplicateWebhook.json()).resolves.toMatchObject({ accepted: true, idempotent: true });

  const credits = await page.request.get("/api/visitor/credits");
  expect(credits.status()).toBe(200);
  const creditBody = await credits.json() as { accounts?: Array<{ facility_id: string; available_credits: number }>; ledger?: Array<{ entry_type: string; amount: number }> };
  expect(creditBody.accounts?.find((account) => account.facility_id === "facility-central-001")?.available_credits).toBe(1);
  expect(creditBody.ledger?.filter((entry) => entry.entry_type === "PURCHASE")).toHaveLength(1);
});

test("visitor profile and relationship evidence survive a browser refresh", async ({ page }) => {
  const email = `journey-${Date.now()}@example.test`;
  const ipAddress = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const requestCode = await page.request.post("/api/auth/visitor/request", { headers: { "cf-connecting-ip": ipAddress }, data: { email } });
  expect(requestCode.status()).toBe(201);
  const challenge = await requestCode.json() as { challengeId?: string; devCode?: string };
  const verify = await page.request.post("/api/auth/visitor/verify", { headers: { "cf-connecting-ip": ipAddress }, data: { challengeId: challenge.challengeId, code: challenge.devCode, displayName: "Journey Visitor" } });
  expect(verify.status()).toBe(200);

  const profile = await page.request.put("/api/visitor/profile", { headers: { origin: testOrigin, "Idempotency-Key": `profile-browser-${Date.now()}` }, data: { legalName: "Journey Visitor", preferredName: "Journey", phone: "+6281234567890" } });
  expect(profile.status()).toBe(200);
  const prisoners = await page.request.get("/api/visitor/prisoners?facilityId=facility-central-001");
  expect(prisoners.status()).toBe(200);
  const prisonerBody = await prisoners.json() as { prisoners?: Array<{ id: string; facility_id: string }> };
  const prisoner = prisonerBody.prisoners?.find((record) => record.id === "prisoner-ar-001");
  expect(prisoner).toBeTruthy();

  const relationship = await page.request.post("/api/visitor/relationships", { headers: { origin: testOrigin }, data: { facilityId: prisoner?.facility_id, prisonerId: prisoner?.id, relationshipType: "Family member" } });
  expect(relationship.status()).toBe(201);
  const relationshipBody = await relationship.json() as { verificationId?: string; status?: string };
  expect(relationshipBody.status).toBe("PENDING");
  expect(relationshipBody.verificationId).toBeTruthy();
  if (!relationshipBody.verificationId) throw new Error("Expected a verification case id");

  const evidence = await page.request.post("/api/visitor/verification/evidence", {
    headers: { origin: testOrigin },
    multipart: {
      verificationCaseId: relationshipBody.verificationId,
      file: { name: "relationship.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n") },
    },
  });
  const evidenceBody = await evidence.json() as { error?: string };
  const evidenceStored = evidence.status() === 201;
  if (evidenceStored) expect(evidenceBody.error).toBeUndefined();
  else expect(evidenceBody.error).toBe("EVIDENCE_STORAGE_NOT_CONFIGURED");
  const relationships = await page.request.get("/api/visitor/relationships");
  expect(relationships.status()).toBe(200);
  const relationshipList = await relationships.json() as { relationships?: Array<{ id: string; decision_history?: Array<{ action_type: string }> }> };
  expect(relationshipList.relationships?.some((record) => Array.isArray(record.decision_history) && record.decision_history.length > 0)).toBe(true);

  await page.goto("/visitor");
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A. Rahman" })).toBeVisible();
  await expect(page.locator("p").filter({ hasText: "Family member · Central Correctional Facility" }).first()).toBeVisible();
  await expect(page.getByText(evidenceStored ? /supporting document received/i : "Supporting document still needed", { exact: evidenceStored ? false : true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A. Rahman" })).toBeVisible();
  await expect(page.locator("p").filter({ hasText: "Family member · Central Correctional Facility" }).first()).toBeVisible();
  await expect(page.getByText(evidenceStored ? /supporting document received/i : "Supporting document still needed", { exact: evidenceStored ? false : true })).toBeVisible();
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Active sessions" })).toBeVisible();
  await expect(page.getByText("This device", { exact: false }).first()).toBeVisible();
});

test("local staff review changes the persisted visitor verification state", async ({ page, browser }) => {
  const email = `review-${Date.now()}@example.test`;
  const ipAddress = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const requestCode = await page.request.post("/api/auth/visitor/request", { headers: { "cf-connecting-ip": ipAddress }, data: { email } });
  expect(requestCode.status()).toBe(201);
  const challenge = await requestCode.json() as { challengeId?: string; devCode?: string };
  const verify = await page.request.post("/api/auth/visitor/verify", { headers: { "cf-connecting-ip": ipAddress }, data: { challengeId: challenge.challengeId, code: challenge.devCode, displayName: "Review Visitor" } });
  expect(verify.status()).toBe(200);

  const relationship = await page.request.post("/api/visitor/relationships", {
    headers: { origin: testOrigin },
    data: { facilityId: "facility-central-001", prisonerId: "prisoner-ar-001", relationshipType: "Family member" },
  });
  expect(relationship.status()).toBe(201);
  const relationshipBody = await relationship.json() as { verificationId?: string };
  expect(relationshipBody.verificationId).toBeTruthy();

  const staff = await browser.newContext({
    extraHTTPHeaders: {
      "oai-authenticated-user-id": "staff-local-supervisor",
      "oai-authenticated-user-email": "staff.local@example.test",
      "oai-authenticated-user-full-name": "Local%20Supervisor",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    },
  });
  try {
    const queue = await staff.request.get("/api/control/verification");
    expect(queue.status(), await queue.text()).toBe(200);
    const queueBody = await queue.json() as { cases?: Array<{ id: string; version: number }> };
    const reviewCase = queueBody.cases?.find((item) => item.id === relationshipBody.verificationId);
    expect(reviewCase).toBeTruthy();

    const decision = await staff.request.post("/api/control/verification", {
      headers: { origin: testOrigin, "Idempotency-Key": `review-more-info-${Date.now()}` },
      data: { verificationCaseId: relationshipBody.verificationId, status: "MORE_INFO", reason: "Please provide relationship evidence." },
    });
    expect(decision.status()).toBe(200);
    await expect(decision.json()).resolves.toMatchObject({ status: "MORE_INFO", relationshipStatus: "PENDING" });
  } finally {
    await staff.close();
  }

  const relationships = await page.request.get("/api/visitor/relationships");
  expect(relationships.status()).toBe(200);
  await expect(relationships.json()).resolves.toMatchObject({ relationships: [{ verification_status: "MORE_INFO", review_reason: "Please provide relationship evidence." }] });
  await page.goto("/visitor");
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A. Rahman", exact: true })).toBeVisible();
});

test("browser requests to protected APIs are rejected without a session", async ({ request }) => {
  const response = await request.get("/api/auth/me");

  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  await expect(response.json()).resolves.toMatchObject({ error: "AUTHENTICATION_REQUIRED" });
});

test("visitor can revoke the current browser session and loses protected access", async ({ page }) => {
  const email = `session-${Date.now()}@example.test`;
  const ipAddress = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const requestCode = await page.request.post("/api/auth/visitor/request", { headers: { "cf-connecting-ip": ipAddress }, data: { email } });
  expect(requestCode.status()).toBe(201);
  const challenge = await requestCode.json() as { challengeId?: string; devCode?: string };
  const verify = await page.request.post("/api/auth/visitor/verify", { headers: { "cf-connecting-ip": ipAddress }, data: { challengeId: challenge.challengeId, code: challenge.devCode, displayName: "Session Test Visitor" } });
  expect(verify.status()).toBe(200);

  const sessionsResponse = await page.request.get("/api/auth/sessions");
  expect(sessionsResponse.status()).toBe(200);
  const sessionsBody = await sessionsResponse.json() as { sessions?: Array<{ id: string; current?: boolean }> };
  const current = sessionsBody.sessions?.find((session) => session.current);
  expect(current?.id).toBeTruthy();

  const revoke = await page.request.post("/api/auth/sessions", {
    data: { sessionId: current?.id },
    headers: { origin: testOrigin, "Idempotency-Key": `session-revoke-browser-${Date.now()}` },
  });
  expect(revoke.status()).toBe(200);
  const protectedResponse = await page.request.get("/api/auth/me");
  expect(protectedResponse.status()).toBe(401);
});
