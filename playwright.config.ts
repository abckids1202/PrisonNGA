import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.PLAYWRIGHT_PORT || "4173";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "line",
  use: {
    baseURL: `http://localhost:${e2ePort}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${e2ePort}`,
    url: `http://localhost:${e2ePort}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      SECUREVISIT_ENVIRONMENT: "development",
      VISITOR_AUTH_DELIVERY: "console",
      PAYMENT_PROVIDER: "local_test",
      PAYMENT_WEBHOOK_SECRET: "local-e2e-payment-secret",
      VISIT_CREDIT_PRICE_MINOR: "50000",
    },
  },
});
