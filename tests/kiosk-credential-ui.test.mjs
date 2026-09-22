import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import KioskCredentialManager from "../app/components/KioskCredentialManager.tsx";

test("resource credential controls explain active state, audit reasons, and step-up requirements", () => {
  const html = renderToStaticMarkup(createElement(KioskCredentialManager, {
    resourceId: "kiosk-02",
    resourceName: "Kiosk 02",
    resourceVersion: 4,
    active: true,
    lastUsedAt: "2026-09-22T08:30:00.000Z",
    onRefresh: async () => undefined,
    onNotify: () => undefined,
  }));

  assert.match(html, /Kiosk credential/);
  assert.match(html, /ACTIVE/);
  assert.match(html, /Rotate credential/);
  assert.match(html, /Revoke/);
  assert.match(html, /Audit reason/);
  assert.match(html, /fresh supervisor step-up/);
  assert.doesNotMatch(html, /localStorage|sessionStorage/);
});

test("a device without an active credential is offered issuance rather than revocation", () => {
  const html = renderToStaticMarkup(createElement(KioskCredentialManager, {
    resourceId: "kiosk-06",
    resourceName: "Kiosk 06",
    resourceVersion: 1,
    active: false,
    onRefresh: async () => undefined,
    onNotify: () => undefined,
  }));

  assert.match(html, /NOT ISSUED/);
  assert.match(html, /Issue credential/);
  assert.doesNotMatch(html, />Revoke</);
});
