import { expect, test } from "@playwright/test";

test("kiosk preparation starts behind an explicit device credential boundary", async ({ page }) => {
  const visitId = "visit-browser-smoke";
  const deviceId = "kiosk-04";
  const credential = "facility-secret-not-for-the-url";

  await page.goto(`/kiosk/visits/${visitId}`);

  await expect(page.getByText("KIOSK PREPARATION", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect this assigned kiosk" })).toBeVisible();
  await expect(page.getByLabel("Registered device ID")).toBeVisible();
  await expect(page.getByLabel("Facility credential")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start device check →" })).toBeVisible();

  await page.getByLabel("Registered device ID").fill(deviceId);
  await page.getByLabel("Facility credential").fill(credential);

  expect(new URL(page.url()).search).toBe("");
  expect(page.url()).not.toContain(credential);
  await expect(page.getByLabel("Facility credential")).toHaveValue(credential);
});

test("kiosk preparation does not claim readiness before the device check runs", async ({ page }) => {
  await page.goto("/kiosk/visits/visit-before-check");

  await expect(page.getByText("This kiosk is ready", { exact: true })).toHaveCount(0);
  await expect(page.getByText("READY", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start device check →" })).toBeVisible();
});
