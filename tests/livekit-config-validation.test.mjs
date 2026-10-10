import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createLiveKitProvider, getVideoConfig } from "../lib/server/video/provider.ts";

test("LiveKit configuration fails closed for unsafe or credential-bearing URLs", async () => {
  const provider = await readFile(new URL("../lib/server/video/provider.ts", import.meta.url), "utf8");
  const config = await readFile(new URL("../lib/server/config.ts", import.meta.url), "utf8");
  assert.match(provider, /url\.protocol === "wss:" \|\| url\.protocol === "https:"/);
  assert.match(provider, /!url\.username && !url\.password/);
  assert.match(config, /LIVEKIT_URL \(must be an https:\/\/ or wss:\/\/ URL without credentials\)/);
});

test("local video provider is development-only and returns bounded test credentials", async () => {
  const previousEnvironment = process.env.SECUREVISIT_ENVIRONMENT;
  const previousProvider = process.env.VIDEO_PROVIDER;
  const previousUrl = process.env.LIVEKIT_URL;
  try {
    process.env.SECUREVISIT_ENVIRONMENT = "development";
    process.env.VIDEO_PROVIDER = "local_test";
    process.env.LIVEKIT_URL = "wss://local-test.invalid";
    const config = await getVideoConfig();
    assert.deepEqual({ provider: config.provider, configured: config.configured }, { provider: "local_test", configured: true });
    const provider = await createLiveKitProvider();
    const session = await provider.createSession("test-room");
    const token = await provider.createParticipantToken({ roomName: session.roomName, identity: "visitor:test", name: "Test Visitor", role: "VISITOR", ttlSeconds: 90 });
    assert.match(token, /^local-test:VISITOR:visitor:test:90:test-room$/);
  } finally {
    if (previousEnvironment === undefined) delete process.env.SECUREVISIT_ENVIRONMENT; else process.env.SECUREVISIT_ENVIRONMENT = previousEnvironment;
    if (previousProvider === undefined) delete process.env.VIDEO_PROVIDER; else process.env.VIDEO_PROVIDER = previousProvider;
    if (previousUrl === undefined) delete process.env.LIVEKIT_URL; else process.env.LIVEKIT_URL = previousUrl;
  }
});

test("local video provider cannot satisfy non-development configuration", async () => {
  const previousEnvironment = process.env.SECUREVISIT_ENVIRONMENT;
  const previousProvider = process.env.VIDEO_PROVIDER;
  try {
    process.env.SECUREVISIT_ENVIRONMENT = "staging";
    process.env.VIDEO_PROVIDER = "local_test";
    const config = await getVideoConfig();
    assert.equal(config.provider, "livekit");
    assert.equal(config.configured, false);
    await assert.rejects(() => createLiveKitProvider(), /VIDEO_PROVIDER_NOT_CONFIGURED/);
  } finally {
    if (previousEnvironment === undefined) delete process.env.SECUREVISIT_ENVIRONMENT; else process.env.SECUREVISIT_ENVIRONMENT = previousEnvironment;
    if (previousProvider === undefined) delete process.env.VIDEO_PROVIDER; else process.env.VIDEO_PROVIDER = previousProvider;
  }
});
