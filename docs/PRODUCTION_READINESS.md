# SecureVisit production-readiness contract

This document separates repository evidence from external launch prerequisites. A green local test suite does not prove that a provider, facility policy, or operational runbook is ready.

## Current repository evidence

- Cloudflare Worker and D1 workflow foundation is present.
- Visitor email/SMS OTP, session revocation, profile, relationship, evidence metadata, appointments, credits, Waiting Room, kiosk, LiveKit, audit, incidents, retention, and notification outbox boundaries are persisted.
- Sensitive mutations use facility scope, permission checks, version checks, idempotency where required, audit events, and outbox events.
- Recording is disabled by policy and must remain disabled for the pilot.
- Development OTP delivery and development simulation controls are environment-gated and are not pilot capabilities.
- Local migration verification, build, typecheck, lint, unit/integration tests, browser smoke tests, and dependency audit must pass before every pushed phase.

## External provider contracts

### Visitor email/SMS delivery

Configure `VISITOR_AUTH_DELIVERY=webhook` with an HTTPS adapter. SecureVisit sends:

- `x-securevisit-timestamp`: Unix timestamp in seconds.
- `x-securevisit-signature`: `sha256=<HMAC-SHA256(timestamp + "." + raw body)>`.
- `idempotency-key`: `visitor-auth:<challengeId>`.

The adapter must validate the timestamp within a five-minute replay window, verify the signature over the raw body, deduplicate the idempotency key, and return a 2xx response only after accepting the message for delivery. It must never log the OTP.

### Payment checkout and webhooks

Configure a real provider adapter only after the institution approves the credit tariff and refund policy. Checkout requests use the payment intent ID as the idempotency key. Payment events must be signed, timestamp-bound, provider-bound, persisted before processing, and safe to replay.

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

Configure `NOTIFICATION_DELIVERY=webhook` with an HTTPS adapter. Notification requests include a stable idempotency key based on the outbox event and destination channel. The adapter must deduplicate retries and return a failure when it cannot accept the message.

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
