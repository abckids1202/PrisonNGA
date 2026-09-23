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

test("browser requests to protected APIs are rejected without a session", async ({ request }) => {
  const response = await request.get("/api/auth/me");

  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  await expect(response.json()).resolves.toMatchObject({ error: "AUTHENTICATION_REQUIRED" });
});
