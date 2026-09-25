# SecureVisit Institutional Pilot — Staging Acceptance Runbook

This runbook is the release gate for a single-facility Indonesian institutional pilot. It is designed to prove that the visitor, staff, kiosk, payment, notification, and video workflows use authoritative persisted state and recover safely from failures.

Staging is not production. Use synthetic identities and sandbox payment accounts, keep recording disabled, and never upload real prisoner or identity documents until the institution has approved the privacy, retention, and access controls.

## 1. Ownership and prerequisites

Assign an owner and an evidence location for every item before the run begins.

| Area | Required staging dependency | Evidence required |
| --- | --- | --- |
| Runtime | Cloudflare Worker, staging D1 database, separate staging secrets | Deployment ID and environment checklist |
| Database | Reviewed migrations, remote D1 database ID/name, backup and restore procedure | Migration output and restore drill record |
| Evidence | Protected R2 bucket, object retention, access logging, purge job | Upload, reviewer access, purge, and denied-access test |
| Visitor identity | Email and/or SMS OTP provider, delivery signing secret, callback/webhook | Delivered OTP, expiry, replay, rate-limit evidence |
| Staff identity | OIDC and SAML metadata, callback URLs, MFA policy, role/facility mapping | Successful login and denied-role evidence for both protocols |
| Payments | One sandbox provider adapter, approved credit tariff, checkout/webhook/refund credentials | Checkout, signed webhook, duplicate, refund, dispute, and reconciliation evidence |
| Video | LiveKit URL, API key/secret, webhook secret, separate staging project | Visitor, kiosk, observer, disconnect, expiry, and termination evidence |
| Notifications | Email/SMS delivery adapter, retry destination, and optional Cloudflare Queue binding (`NOTIFICATION_QUEUE_NAME`) | Delivery attempt, queue/cron processing, retry, dead-letter, and replay evidence |
| Operations | WAF/rate limits, logs, alerts, support ownership, incident runbooks | Alert screenshots/links and acknowledged test incidents |
| Governance | Retention schedule, legal hold process, privacy/correctional approval, recording-off decision | Signed approval record |

Secrets must be managed by the deployment secret store. Do not paste secrets into tickets, test evidence, shell history, screenshots, or this repository.

## 2. Environment separation

Maintain separate credentials, D1 databases, R2 buckets, LiveKit projects, webhook endpoints, payment accounts, and identity-provider applications for local, staging, and production. Local adapters and fictional seed data prove developer behavior only; they do not prove provider readiness.

Before each staging run:

1. Confirm the deployment points to the staging D1 database and staging provider endpoints.
2. Confirm recording is disabled at the application and LiveKit project level.
3. Confirm the approved staging tariff is configured; never use the local example price.
4. Confirm the staging facility, prisoner, visitor, kiosk, and staff fixtures are synthetic and traceable to the test run.
5. Confirm observability is receiving request IDs, facility IDs, actor IDs, session IDs, and correlation IDs without logging secrets or sensitive evidence.

## 3. Preflight commands

Run these from a clean checkout with the intended staging environment loaded. The commands must not print secret values.

```bash
npm ci
npm run validate:environment
npm run db:migrations:list
npm run db:migrate:remote
npm run build
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm audit --omit=dev --audit-level=high
```

Then verify the deployed readiness endpoint:

```text
GET /api/health/live
GET /api/health/readiness (authenticated staff request with facility.read)
```

The response must indicate that required staging bindings and provider configuration are available. Do not seed staging with `db:seed:local`; load only an approved, synthetic staging fixture through the controlled data process.

## 4. Critical end-to-end acceptance journey

Record timestamps, actor IDs, request/correlation IDs, resulting database records, and audit/outbox IDs for each step. Repeat the journey after refreshes and with duplicate submissions where noted.

### A. Visitor identity and verification

1. Visitor requests an OTP through the real staging delivery provider.
2. Verify the OTP expires, cannot be replayed, and is rate-limited.
3. Verify session expiry, sign-out, and visitor authorization boundaries.
4. Visitor completes profile and submits a prisoner relationship request.
5. Visitor uploads synthetic evidence metadata to protected storage.
6. Staff opens the evidence through the authorized route; confirm the access is audited and an unauthorized facility/role is denied.
7. Staff approves the relationship. Refresh both sessions and confirm the persisted decision and notification.

### B. Credit purchase and ledger integrity

1. Visitor starts checkout for the approved tariff.
2. Confirm the payment intent is persisted with an idempotency key and no credit is granted before payment confirmation.
3. Complete the sandbox checkout.
4. Deliver a valid signed webhook, then deliver the same event again and out of order.
5. Confirm exactly one ledger purchase, correct balance, notification, and audit trail.
6. Exercise an expired payment, refund, dispute, and delayed provider event. Confirm the ledger remains append-only and the visitor never sees a false successful balance.

### C. Appointment policy and approval

1. Visitor requests an available slot after relationship approval.
2. Confirm server-side policy checks for facility hours, booking horizon, prisoner eligibility, overlap, and visitor overlap.
3. Submit the request twice with the same idempotency key; confirm one appointment.
4. Staff reviews the request and sees the full decision history and SLA state.
5. Approve once, repeat the approval, and confirm no duplicate reservation or credit reservation.
6. Attempt a conflicting appointment concurrently; confirm only one succeeds and the loser receives a recoverable conflict response.
7. Refresh visitor and staff pages and verify the same persisted status, reserved resource, credit state, and notifications.

### D. Device check and Waiting Room

1. Visitor completes camera, microphone, network, browser, and consent checks; persist each result with timestamp and session correlation.
2. Visitor enters the Waiting Room only during the allowed window.
3. Authenticate the controlled kiosk with its enrolled, revocable credential; confirm a kiosk ID alone is rejected.
4. Kiosk reports heartbeat, prisoner presence, device status, and assigned resource.
5. Staff sees the same appointment in the queue and the correct readiness state: `NOT ARRIVED`, `VISITOR WAITING`, `PRISONER WAITING`, `BOTH PRESENT`, `TECHNICAL ISSUE`, `STAFF REVIEW`, `READY TO START`, or `LATE`.
6. Run staff actions: admit, retry device, contact visitor, mark late, reassign resource, escalate, and cancel. Confirm invalid transitions are rejected and every accepted transition creates history, audit, and required notifications.

### E. Live Session and completion

1. Staff runs the preflight checks and starts the visit.
2. Visitor, kiosk, and authorized staff observer join the same LiveKit room with scoped, expiring tokens.
3. Confirm recording is disabled and no recording route or provider setting enables it.
4. Test a visitor disconnect/reconnect, kiosk disconnect, observer removal, expired token, and provider webhook retry.
5. End the session from staff control and repeat the end request to verify idempotency.
6. Confirm the appointment reaches the correct completion outcome, the credit is consumed or released exactly once according to policy, and the visitor receives a receipt/status update.
7. Confirm session participants, presence events, provider events, audit records, and outbox events remain visible after refresh.

## 5. Failure rehearsal matrix

| Failure | Expected result | Must not happen |
| --- | --- | --- |
| Invalid or replayed OTP | Rejected, rate-limited, audited | Session creation or account takeover |
| Payment timeout | Intent remains pending/failed and retryable | Credit granted |
| Duplicate/wrong payment webhook | Duplicate ignored; invalid signature rejected | Second ledger purchase |
| Delayed refund/dispute | Pending state and staff visibility | Silent balance mutation |
| LiveKit outage | Visit remains waiting/not-started; staff can retry | Appointment marked live or credit consumed |
| Kiosk heartbeat loss | Technical issue/staff attention state | Automatic admission |
| Camera/mic/network failure | Device check fails with actionable recovery | Ready-to-start state |
| Staff session expiry | Action denied and safely retryable after re-authentication | Partial transition |
| Notification provider failure | Retry/backoff/dead-letter with support visibility | Duplicate uncontrolled sends |
| Evidence storage failure | Upload/access fails closed and is auditable | Public or untracked document access |
| D1/provider interruption | Safe error, retry or incident path | Fictional success or lost audit trail |

## 6. Go/no-go gates

The pilot is **no-go** if any gate is unproven:

- The complete journey succeeds in staging using real sandbox identity, payment, notification, and LiveKit providers.
- Every protected route enforces identity, facility scope, permission, validation, and idempotency where required.
- Refreshes, duplicate requests, delayed webhooks, provider outages, and unauthorized access attempts preserve correct state.
- Credit, reservation, refund, and settlement invariants pass concurrent and replay tests.
- Kiosk enrollment and revocation are demonstrated on the controlled-device flow.
- Backups restore into a clean D1 database and the result is verified.
- WAF/rate limits, alerting, log redaction, and operational ownership are active.
- Retention, deletion, legal hold, evidence access, and recording-off policies are approved.
- Staff role/facility mapping works through both OIDC and SAML with MFA.
- A security review and Indonesian privacy/correctional-policy review are complete, with findings either closed or explicitly accepted by the institution.
- The evidence bundle is signed by product, engineering, operations, security, and facility owners.

## 7. Rollback and incident procedure

When a gate fails, stop the journey at the failed boundary, preserve correlation IDs and provider event IDs, and do not manually edit balances or appointment status. Disable new booking or admission if needed, keep existing sessions safe, and use the documented compensating action (retry, refund, release reservation, or incident escalation). Any break-glass access requires a reason, supervisor approval, time limit, and audit record.

After recovery, replay only idempotent events through the supported operational tool, compare the database ledger with provider records, and attach the reconciliation report to the incident. Do not delete failed evidence or audit records to make a run appear successful.

## 8. Evidence retention

Keep the acceptance evidence for the institution-approved period. Store test identities and screenshots separately from production data. Apply deletion and legal-hold rules to synthetic evidence, payment identifiers, provider events, audit exports, and incident records. Record who approved the retention and who executed deletion.

This runbook is a release process, not a substitute for configuring the providers, completing institutional approvals, or conducting an independent security review. SecureVisit must not be represented as production-ready until these gates pass.
