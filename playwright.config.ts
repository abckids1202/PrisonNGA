import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.PLAYWRIGHT_PORT || "4173";
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  // The suite shares one persisted local D1 database and a Cloudflare Worker
  // process. Parallel browser workers multiply Miniflare/Chromium memory and
  // can make the release gate fail from host pressure rather than a product
  // regression. Keep the gate deterministic; scale out only with an explicit
  // isolated test-environment strategy.
  fullyParallel: false,
  workers: 1,
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
    // Never trust an arbitrary process already listening on the test port.
    // Opt in explicitly when a caller has started the correctly configured
    // SecureVisit server and wants Playwright to reuse it.
    reuseExistingServer,
    timeout: 120_000,
    env: {
      SECUREVISIT_ENVIRONMENT: "development",
      VISITOR_AUTH_DELIVERY: "console",
      PAYMENT_PROVIDER: "local_test",
      PAYMENT_WEBHOOK_SECRET: "local-e2e-payment-secret",
      VISIT_CREDIT_PRICE_MINOR: "50000",
      EVIDENCE_STORAGE_PROVIDER: "local_test",
      ...(process.env.SECUREVISIT_LOCAL_D1_STATE_DIR ? { SECUREVISIT_LOCAL_D1_STATE_DIR: process.env.SECUREVISIT_LOCAL_D1_STATE_DIR } : {}),
    },
  },
});
