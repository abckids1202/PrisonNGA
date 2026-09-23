import { expect, test } from "@playwright/test";

test("control workspace renders its operational shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("SecureVisit Control").first()).toBeVisible();
  await expect(page.getByText("Command Center", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("DEMO ENVIRONMENT", { exact: true })).toBeVisible();
});

test("visitor workspace is a separate authenticated boundary", async ({ page }) => {
  await page.goto("/visitor");

  await expect(page.getByText("SECUREVISIT VISITOR", { exact: true })).toBeVisible();
  await expect(page.getByText("Sign in with a one-time code to manage visits and connections.")).toBeVisible();
  await expect(page.getByText("Action center", { exact: true })).toHaveCount(0);
});

test("development visitor OTP creates a real browser session", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;
  const requestCode = await page.request.post("/api/auth/visitor/request", { data: { email } });
  expect(requestCode.status()).toBe(201);
  const challenge = await requestCode.json() as { challengeId?: string; devCode?: string };
  expect(challenge.challengeId).toBeTruthy();
  expect(challenge.devCode).toMatch(/^\d{6}$/);

  const verify = await page.request.post("/api/auth/visitor/verify", { data: { challengeId: challenge.challengeId, code: challenge.devCode, displayName: "Browser Visitor" } });
  expect(verify.status()).toBe(200);
  await expect(verify.json()).resolves.toMatchObject({ authenticated: true, visitor: { displayName: "Browser Visitor" } });

  await page.goto("/visitor");
  await expect(page.getByText("Hello, Browser Visitor")).toBeVisible();
  await expect(page.getByText("Your visitor account", { exact: true })).toBeVisible();
});

test("development visitor SMS OTP creates a real browser session", async ({ page }) => {
  const phone = `+62812${String(Date.now()).slice(-8)}`;
  const requestCode = await page.request.post("/api/auth/visitor/request", { data: { channel: "SMS", phone } });
  expect(requestCode.status()).toBe(201);
  const challenge = await requestCode.json() as { challengeId?: string; channel?: string; destination?: string; devCode?: string };
  expect(challenge.channel).toBe("SMS");
  expect(challenge.destination).toMatch(/^\+62••••\d{2}$/);
  expect(challenge.devCode).toMatch(/^\d{6}$/);

  const verify = await page.request.post("/api/auth/visitor/verify", { data: { challengeId: challenge.challengeId, code: challenge.devCode, displayName: "SMS Browser Visitor" } });
  expect(verify.status()).toBe(200);
  await expect(verify.json()).resolves.toMatchObject({ authenticated: true, visitor: { displayName: "SMS Browser Visitor", phone } });
});

test("browser requests to protected APIs are rejected without a session", async ({ request }) => {
  const response = await request.get("/api/auth/me");

  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  await expect(response.json()).resolves.toMatchObject({ error: "AUTHENTICATION_REQUIRED" });
});
