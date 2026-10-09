# SecureVisit production-readiness contract

This document separates repository evidence from external launch prerequisites. A green local test suite does not prove that a provider, facility policy, or operational runbook is ready.

The failure behavior contract for the pilot is documented in [FAILURE_HANDLING.md](./FAILURE_HANDLING.md).

## Current repository evidence

- Cloudflare Worker and D1 workflow foundation is present.
- Visitor email/SMS OTP, session revocation, profile, relationship, evidence metadata, appointments, credits, Waiting Room, kiosk, LiveKit, audit, incidents, retention, and notification outbox boundaries are persisted.
- Sensitive mutations use facility scope, permission checks, version checks, idempotency where required, audit events, and outbox events.
- Recording is disabled by policy and must remain disabled for the pilot.
- Development OTP delivery and development simulation controls are environment-gated and are not pilot capabilities.
- Local migration verification, build, typecheck, lint, unit/integration tests, browser smoke tests, and dependency audit must pass before every pushed phase.

### Baseline verification — 2026-10-09

The current repository baseline was rechecked against the pilot contract:

- `npm run test:quick`: 442 application tests passed. The release verifier runs the migration verification as a separate release gate rather than presenting a combined test count.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- Production build: passed.
- Local D1 migration verification: passed.
- Browser smoke suite: 17 tests passed on an isolated local port with the disposable D1 state shared by migrations and the Worker process.
- `npm audit --audit-level=high`: 0 vulnerabilities reported.
- Working tree: clean after the verified code push (`6f7f2ad`).

The notification delivery boundary also persists provider references and accepts signed, replay-safe delivery-status callbacks for delivered, failed, bounced, rejected, undelivered, and invalid-recipient outcomes. This is repository evidence only; real provider webhook delivery still requires staging configuration and a recorded acceptance run.

This evidence proves the repository workflows and local failure handling remain internally consistent. It does not prove external provider readiness, institutional policy approval, real hardware operation, or production resilience.

## External provider contracts

### Visitor email/SMS delivery

Configure either the signed HTTPS adapter (`VISITOR_AUTH_DELIVERY=webhook`) or the direct adapters (`VISITOR_EMAIL_DELIVERY=resend` and/or `VISITOR_SMS_DELIVERY=twilio`). The signed adapter receives:

- `x-securevisit-timestamp`: Unix timestamp in seconds.
- `x-securevisit-signature`: `sha256=<HMAC-SHA256(timestamp + "." + raw body)>`.
- `idempotency-key`: `visitor-auth:<challengeId>`.

The direct adapters call Resend and Twilio from the Worker using server-only credentials and the same challenge idempotency key. Direct provider credentials must be configured separately for each channel; they are never returned to the browser.

The adapter must validate the timestamp within a five-minute replay window, verify the signature over the raw body, deduplicate the idempotency key, and return a 2xx response only after accepting the message for delivery. It must never log the OTP.

### Payment checkout and webhooks

Configure a real provider adapter only after the institution approves the credit tariff and refund policy. The tariff is stored on the facility's versioned Visit Policy and must be explicitly configured before a non-development facility can accept checkout; `VISIT_CREDIT_PRICE_MINOR` is only a local development fallback. Checkout requests use the payment intent ID as the idempotency key. Payment events must be signed, timestamp-bound, provider-bound, persisted before processing, and safe to replay.

Settlement events must also carry the provider reference, amount in minor currency units, and ISO currency. SecureVisit compares these against the persisted payment intent before posting credits; a signed event with mismatched settlement details is rejected and remains retryable for investigation.

The provider integration is not pilot-ready until sandbox tests prove:

1. checkout creation;
2. delayed payment;
3. duplicate webhook delivery;
4. invalid signature and replay rejection;
5. expiration;
6. refund;
7. dispute/chargeback;
8. reconciliation against the provider record.

### Notifications

Configure `NOTIFICATION_DELIVERY=webhook` with an HTTPS adapter, or use `NOTIFICATION_EMAIL_DELIVERY=resend` and/or `NOTIFICATION_SMS_DELIVERY=twilio` with the direct provider credentials. Notification requests include a stable idempotency key based on the outbox event and destination channel. The adapter must deduplicate retries and return a failure when it cannot accept the message.

For staging and production, set `NOTIFICATION_QUEUE_NAME` to the provisioned Cloudflare Queue name to dispatch outbox draining through the queue consumer. The scheduled Worker remains a durable fallback for queue-dispatch failures; queue delivery must still be monitored for retry and dead-letter activity.

## Pilot go/no-go gates

The pilot cannot open to real visitors until all of these have evidence:

- one tested email or SMS delivery provider;
- one tested payment provider and approved tariff;
- institutional OIDC or SAML with MFA;
- remote D1 migration review and restore drill;
- protected evidence storage and retention verification;
- visitor, kiosk, and staff LiveKit staging session;
- notification delivery, retry, dead-letter, and replay operations;
- WAF and deployed rate limits;
- monitoring and alerting;
- security review;
- Indonesian privacy and correctional-policy approval;
- complete staging journey from visitor sign-in through receipt and audit.

The following items are intentionally not marked complete by local tests and require external evidence:

- production email/SMS delivery and OTP operations;
- institutional OIDC/SAML identity mapping with enforced MFA;
- payment-provider sandbox checkout, webhook, refund, dispute, and reconciliation tests;
- protected object storage, malware scanning, retention, legal hold, and restore verification;
- remote D1 migration review, backup, and restore drill;
- three-party visitor/kiosk/staff LiveKit session using real configured credentials;
- deployed WAF, rate limits, monitoring, alerting, secret rotation, and outage rehearsal;
- independent security review and Indonesian privacy/correctional-policy approval.

Until each item has a named owner, environment, test evidence, and approval record, the release status remains `STAGING FOUNDATION — NOT PILOT READY`.

## Failure-handling rule

Every provider failure must leave the domain in a persisted, user-visible state. A retry must be idempotent. Credit disposition, staff action, audit event, notification behavior, and terminal state must be defined before the feature is enabled.

## Staging acceptance journey

Run this with separate visitor, staff, and kiosk identities:

1. Visitor requests and verifies an email or phone challenge.
2. Visitor submits a relationship and protected evidence metadata.
3. Staff reviews and approves the relationship.
4. Visitor purchases one sandbox credit.
5. Visitor submits an appointment request.
6. Staff approves it and verifies the resource and credit reservations.
7. Visitor completes device checks and enters Waiting Room.
8. Kiosk authenticates, reports presence, and completes its checks.
9. Staff admits the visit and joins as a restricted observer.
10. Visitor and kiosk join the same LiveKit session.
11. Staff ends the session.
12. SecureVisit finalizes the outcome, settles or releases the credit, creates notifications, and records audit history.
13. Refresh each participant's pages and verify the same persisted state.
14. Repeat the payment webhook and termination requests and verify no duplicate ledger entries or transitions.
