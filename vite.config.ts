import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };
import { sites } from "./build/sites-vite-plugin.ts";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// Queue names are deployment configuration, not application secrets. Leave
// the binding absent locally so the scheduled D1 outbox worker remains the
// default development path.
const notificationQueueName = process.env.NOTIFICATION_QUEUE_NAME?.trim();

// Vite loads `.env.local` for application code, but the Cloudflare Worker
// isolate only receives values explicitly copied into its `vars` binding.
// Read the local file here as a fallback while allowing an explicit process
// environment (for example the isolated browser release runner) to win.
const loadedLocalEnvironment = loadEnv("development", process.cwd(), "");
const runtimeEnvironmentValue = (key: string): string | undefined => process.env[key] || loadedLocalEnvironment[key] || undefined;
const isolatedDevelopmentE2E = process.env.SECUREVISIT_E2E_ISOLATED === "true";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const environmentVars: Record<string, string> = {};
for (const key of [
  "SECUREVISIT_ENVIRONMENT",
  "VISITOR_AUTH_DELIVERY",
  "PAYMENT_PROVIDER",
  "PAYMENT_CHECKOUT_URL",
  "PAYMENT_REFUND_URL",
  "PAYMENT_PROVIDER_SECRET",
  "PAYMENT_WEBHOOK_SECRET",
  "VISIT_CREDIT_PRICE_MINOR",
  "EVIDENCE_STORAGE_PROVIDER",
  "SECUREVISIT_E2E_ISOLATED",
]) {
  const value = runtimeEnvironmentValue(key);
  if (value) environmentVars[key] = value;
}

// The release browser suite is intentionally self-contained. Keep these
// adapters available only to the disposable development Worker so it can
// exercise the persisted journey without ever making them valid for staging
// or production.
if (isolatedDevelopmentE2E) {
  Object.assign(environmentVars, {
    VISITOR_AUTH_DELIVERY: "console",
    PAYMENT_PROVIDER: "local_test",
    PAYMENT_WEBHOOK_SECRET: "local-development-payment-webhook-secret-0123456789",
    VISIT_CREDIT_PRICE_MINOR: "50000",
    EVIDENCE_STORAGE_PROVIDER: "local_test",
  });
}

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  triggers: { crons: ["*/1 * * * *"] },
  // Vite/Miniflare does not automatically forward process env into the
  // Worker isolate. Only forward an explicitly supplied deployment mode;
  // an absent value must remain fail-closed.
  vars: environmentVars,
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
  queues: notificationQueueName
    ? {
        producers: [{ binding: "NOTIFICATION_QUEUE", queue: notificationQueueName }],
        consumers: [{ queue: notificationQueueName, max_batch_size: 25, max_batch_timeout: 5 }],
      }
    : undefined,
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        persistState: process.env.SECUREVISIT_LOCAL_D1_STATE_DIR
          ? { path: process.env.SECUREVISIT_LOCAL_D1_STATE_DIR }
          : true,
        config: localBindingConfig,
      }),
    ],
  };
});
