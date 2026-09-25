# SecureVisit Institutional Pilot — Finish Plan

This document is the execution baseline for taking SecureVisit from a persisted prototype to a staging-ready, single-facility institutional pilot. The existing UI is not evidence that a workflow is complete. A capability is complete only when its state is persisted, authorized, transactional, retry-safe, audited, observable, and proven after refresh and failure.

## Current position

The repository currently provides a substantial platform foundation:

- Cloudflare Worker, D1 migrations, facility-scoped authorization, visitor email/SMS OTP development flow, staff federation structure, visitor relationships, appointment and waiting-room APIs, LiveKit session/token foundations, append-only credit ledger, payment webhook processing, notification outbox, retention/legal-hold workflows, audit exports, incidents, browser smoke tests, and recording-disabled enforcement.
- The latest automated baseline is 307 server tests and 16 browser tests. Development E2E covers signed payment settlement, duplicate webhook delivery, the persisted verification-to-payment-to-appointment approval handoff through a local-only provider adapter, and the management-to-operations resource handoff; this proves the boundary, not readiness for real external providers.

The product remains a staging candidate rather than a production institutional system. The main gap is external proof and a few workflow joins: real provider adapters, full refresh-safe journey coverage, kiosk/device reality, and operational recovery.

## Release gates

The pilot cannot be approved until every gate below has evidence attached to the release record.

| Gate | Required evidence | Current assessment |
| --- | --- | --- |
| Identity | Real email delivery sandbox, institutional OIDC/SAML assertion tests, MFA claim evidence, logout/revocation test | Blocked by provider configuration and institutional IdP access |
| Money | Selected provider, sandbox checkout, signed webhook retries, refund/dispute/reconciliation evidence | Adapter exists; real provider and tariff are not selected |
| Evidence | Protected R2 bucket, malware scanner, signed staff-only access, retention/restore drill | Interface and workflow exist; external storage/scanner are not proven |
| Appointment integrity | Concurrent approval, resource collision, credit reservation/release, cancellation/reschedule tests on staging D1 | Core transactions exist; complete staging journey remains unproven |
| Waiting room | Visitor, kiosk, and staff clients using one appointment with persisted presence/readiness | APIs and clients exist; controlled-device validation remains |
| Live session | Visitor+kiosk+observer LiveKit room, reconnect, timeout, termination, settlement | Provider integration exists; three-party staging rehearsal remains |
| Operations | Queue retry/dead-letter/replay, notification delivery, incident resolution, audit export, access review | Foundations exist; operational rehearsal and monitoring remain |
| Resilience | D1 backup/restore, provider outage, stale-session cleanup, database unavailability drills | Not release-proven |
| Governance | Indonesian privacy/correctional review, retention schedule, recording policy decision, security review | External approval required |

## Authoritative workflow

### Visitor

```text
visitor session
→ verified contact
→ profile
→ relationship submitted
→ evidence uploaded and scanned
→ staff decision
→ approved connection
→ confirmed credit balance
→ appointment request
→ staff approval and resource reservation
→ device check persisted
→ waiting-room check-in
→ staff admission
→ LiveKit session
→ server finalization
→ credit settlement/refund
→ receipt, notification, decision history
```

### Staff

```text
OIDC/SAML + IdP MFA
→ facility and role mapping
→ verification review
→ appointment policy decision
→ room/device and credit reservation
→ waiting-room queue
→ readiness/blocker resolution
→ admission
→ restricted observer
→ end/terminate
→ outcome and settlement
→ incident/audit/notification review
```

### Kiosk

```text
device credential
→ facility binding
→ assigned appointment
→ prisoner presence
→ device check
→ waiting state
→ LiveKit join
→ heartbeat/presence
→ server termination
→ local data clear
→ kiosk-ready state
```

## State invariants

These rules must be enforced in server transactions, never inferred by the browser.

1. An appointment can be approved only when the visitor is eligible, the relationship is approved, the prisoner is eligible, policy allows the visit, the requested interval is free, a room/device is reserved, and one credit is reserved.
2. A visit can enter `READY_TO_START` only when the current visitor device check, kiosk device check, kiosk heartbeat, visitor presence, prisoner presence, identity/session verification, resource health, and facility restriction checks all pass.
3. A LiveKit room may be created or joined only for an approved appointment admitted by staff, with an unexpired scoped token and recording state `OFF`/`NOT_RECORDED`.
4. A credit purchase is created only from a verified provider event with matching amount, currency, provider reference, and idempotency key. The browser success screen is never authoritative.
5. A purchase ledger entry is append-only and created once. Refunds and reservations use distinct idempotency keys and cannot make the available balance negative.
6. Every sensitive state transition writes an audit event in the same batch as the domain update, or the domain update is rejected.
7. Every retryable external operation has a durable attempt record, backoff, dead-letter state, and replay path.
8. Facility ID and actor permission must be present on every protected read and write. Resource IDs, appointment IDs, evidence IDs, and session IDs are never sufficient authorization by themselves.

## Failure contract

| Failure | Visitor sees | Retry | Credit behavior | Staff action | Required record |
| --- | --- | --- | --- | --- | --- |
| OTP delivery unavailable | Delivery unavailable; no sign-in | Retry after server throttle | None | Review delivery health if repeated | delivery attempt + security event |
| Payment rejected | Payment not confirmed | Start a new checkout safely | No purchase | None unless repeated | provider event + audit + notification |
| Payment delayed | Awaiting confirmation | Poll/refresh; provider webhook | No credit until confirmed | Reconcile if SLA breached | payment status + notification |
| Duplicate webhook | Existing confirmed state | No-op | No duplicate ledger entry | None | idempotent provider event |
| Appointment collision | Slot no longer available | Choose another slot | Release any provisional reservation | Review only if repeated | decision/audit event |
| Credit reservation failure | Appointment not approved | Retry after balance refresh | No reservation retained | Resolve ledger/resource issue | transaction error + audit |
| Visitor late | Late/check-in status | Rejoin if policy allows | Settlement follows policy | Mark late, extend or no-show | presence + transition + notification |
| Prisoner unavailable | Facility delay message | Wait for staff outcome | Refund/release by policy | Reschedule, cancel, or escalate | incident + decision + notification |
| Camera/microphone failure | Specific device guidance | Retry/device selection | Credit remains reserved | Contact or reschedule | persisted device attempt |
| Network degraded | Connection warning | Retry test or reconnect | No automatic consumption | Monitor/admit only when ready | device/network result |
| Kiosk disconnected | Waiting state, not false-ready | Heartbeat/reconnect | No settlement until finalization | Reassign/escalate | kiosk heartbeat + incident |
| LiveKit unavailable | Session cannot start/reconnect | Provider retry | Refund/release per outcome | Terminate or reschedule | provider event + incident |
| Staff session expired | Sign-in required | Re-authenticate | Domain state unchanged | Reopen safely | auth/security event |
| Notification failure | In-app status remains source of truth | Worker retry/replay | None | Monitor dead letter | delivery attempt/outbox |
| Refund delayed | Refund pending | Worker/provider retry | Credit reversal follows confirmed policy | Finance reconciliation | refund request + provider event |
| Database unavailable | Temporary service error | Safe retry with idempotency | No client-side assumption | Alert on-call | request/correlation log |

## Ordered implementation backlog

### Sprint 0 — release controls

- Add a staging release checklist tied to environment readiness, migration version, provider configuration, and rollback target.
- Confirm facility ID, timezone, visit duration, credit tariff, cancellation/refund policy, notification channels, retention schedule, and recording policy with the institution.
- Add health/readiness dashboard evidence for D1, LiveKit, payment, visitor delivery, notification, evidence storage, and scanner providers.

### Sprint 1 — visitor identity and verification

- Configure a real email provider behind the existing delivery boundary; keep development console delivery impossible outside development.
- Run provider-sandbox delivery, expiry, replay, attempt-limit, throttling, session revocation, and suspicious-login tests.
- Configure protected R2 and scanner. Complete evidence upload, scan result callback, signed access, request-more-information, approval/rejection reasons, renewal, retention, and deletion tests.
- Add a browser journey that refreshes after each step and verifies visitor-visible decision history.

### Sprint 2 — money and appointment integrity

- Select one provider and map its statuses into the provider-neutral adapter.
- Verify checkout return does not settle credits; only the verified webhook does.
- Test failed, expired, duplicated, out-of-order, refunded, disputed, and replayed events.
- Run concurrent slot approval and cancellation/reschedule tests on staging D1. Verify room/device and credit reservation are released on every rejection, cancellation, expiry, and no-show path.

### Sprint 3 — waiting room and kiosk

- Enroll a real controlled device with a facility-bound credential and rotation/revocation procedure.
- Persist visitor, prisoner, and kiosk presence with timestamps and independent actors.
- Persist camera, microphone, network, kiosk heartbeat, and resource health results with freshness windows.
- Exercise every transition: `NOT_ARRIVED`, `VISITOR_WAITING`, `PRISONER_WAITING`, `BOTH_PRESENT`, `TECHNICAL_ISSUE`, `STAFF_REVIEW`, `LATE`, `READY_TO_START`, `CANCELLED`, `NO_SHOW`.
- Add short polling/reconnect behavior and verify staff actions remain safe after duplicate clicks and stale versions.

### Sprint 4 — Live session

- Run visitor, kiosk, and staff observer clients against one LiveKit staging project.
- Validate token identity, grants, expiry, room binding, observer read-only permissions, recording-off enforcement, and provider webhook authenticity.
- Rehearse reconnect, participant drop, provider outage, session timeout, staff termination, browser refresh, and stale-room cleanup.
- Finalize the session once, then settle/refund one credit once, emit one receipt, one audit trail, and the expected notifications.

### Sprint 5 — operations and governance

- Exercise notification retry/backoff/dead-letter/replay and verify deduplication.
- Complete incident assignment, investigation, resolution, escalation, and audit export.
- Run access review and staff provisioning workflows, including role removal and session revocation.
- Run retention, legal hold, break-glass, evidence deletion, backup/restore, and database access drills.
- Add dashboards and alerts for dead letters, failed webhooks, stale sessions, provider outages, failed migrations, and unusual authentication activity.

### Sprint 6 — acceptance and go/no-go

- Run the complete twelve-step browser journey with real sandbox providers and three actors.
- Run concurrency, refresh, duplicate-request, delayed-webhook, provider-outage, and unauthorized-access suites.
- Attach migration, backup/restore, security review, privacy review, correctional-policy approval, and operational-runbook evidence.
- Launch only if every release gate is green and unresolved issues have an owner, severity, mitigation, and explicit pilot sign-off.

## Required browser acceptance journey

The final Playwright scenario must use persisted records and separate browser contexts:

1. Visitor requests and verifies an email OTP through the configured sandbox.
2. Visitor completes profile and relationship evidence submission.
3. Staff reviews and approves the relationship.
4. Visitor starts sandbox checkout; browser success alone does not change balance.
5. Provider webhook is delivered twice; exactly one purchase is posted.
6. Visitor selects an eligible slot and submits an appointment.
7. Staff approves; one room/device and one credit reservation are visible.
8. Visitor completes device check and checks in.
9. Kiosk authenticates, reports presence/device readiness, and joins the waiting queue.
10. Staff resolves readiness and admits the visit.
11. Visitor, kiosk, and staff observer join the same LiveKit session.
12. Staff ends the session; refreshes show final outcome, credit settlement, receipt, notification, audit, and decision history.

The same scenario must be repeated with at least one failure injected at each external boundary.

## Detailed implementation prompt for the next coding sprint

> Work in `C:\Users\charl\OneDrive\Desktop\PrisonNGA`. Implement Sprint 1 and Sprint 2 as one production-structured vertical slice, preserving the existing visual system. First inspect the current schema, routes, authorization helpers, migrations, tests, and audit document. Do not add demo records or query-string business state.
>
> Complete visitor identity and verification: keep provider delivery behind the existing adapter, enforce environment fail-closed behavior, persist delivery attempts, rate limits, expiry, one-time consumption, suspicious-login events, session revocation, and refresh-safe visitor authorization. Complete evidence storage through an R2 abstraction with strict facility-scoped signed access, content-length/type validation, scanner status, request-more-information, approval/rejection reasons, retention metadata, and visitor notifications. Every sensitive update must be optimistic-concurrency checked and batched with audit/outbox statements.
>
> Complete payment and appointment integrity: implement the selected provider behind `PaymentProvider`, verify signed timestamped webhooks, preserve provider-event idempotency and dead-letter retries, post one append-only purchase, reserve/release credits transactionally, support refund/dispute state transitions, and expose reconciliation issues to authorized finance staff. Enforce eligibility, policy, availability, resource collision prevention, decision history, cancellation, and rescheduling on the server. Never settle from a client return URL. Never approve without the relationship, resource, and credit invariants.
>
> Add tests before claiming completion: malformed and replayed OTPs, facility isolation, unauthorized evidence access, scanner failure, duplicate relationship review, payment webhook duplication/out-of-order/refund/dispute, concurrent appointment approvals, resource collision, credit reservation release, cancellation, rescheduling, audit creation, notification retry, and refresh persistence. Add a browser test with separate visitor and staff contexts that proves the persisted journey through approved appointment and confirmed credit.
>
> Run `npm run typecheck`, `npm run lint`, `npm test`, fresh migration tests, `npm run test:e2e`, `npm audit --omit=dev`, and `git diff --check`. Update `docs/INSTITUTIONAL_PILOT_AUDIT.md` with evidence and remaining external gates. Commit with a focused message and push to `origin main`. Do not call the system production-ready unless real provider sandbox evidence and institutional approvals are present.

## Spin interaction specification

The spin is presentation only. The server or authoritative domain command selects and persists the result before animation begins. The client receives a result ID, selected segment, deterministic final angle, and audit/correlation ID; animation timing never decides a payment, queue, reward, or appointment outcome.

- Duration: 4.2–5.5 seconds.
- First 0–15%: extremely fast acceleration.
- 15–55%: high-speed rotation.
- 55–80%: controlled deceleration.
- Final 80–100%: long, smooth settling with no bounce.
- Use a deterministic angle: selected segment center plus bounded offset plus full turns.
- Disable the trigger while running, make repeated requests idempotent, and recover the persisted result after refresh.
- Respect `prefers-reduced-motion`; show an immediate result state with the same audit ID.
- Keep audio optional and haptics progressive-enhancement only.
- Test boundary segments, repeated clicks, refresh during animation, reduced motion, server retry, and mismatched client angles.

This interaction must not be introduced into the institutional visit workflow until its business meaning, authorization, and audit semantics are explicitly approved.

## Definition of done

SecureVisit is ready for a controlled pilot only when:

- the complete visitor/staff/kiosk workflow uses persisted state and survives refresh;
- every protected route enforces identity, facility, permission, validation, and idempotency requirements;
- duplicate requests, delayed webhooks, provider failures, stale sessions, and resource collisions are safe;
- money, evidence, sessions, incidents, notifications, and audit records reconcile;
- recordings remain disabled and the policy is technically enforced;
- fresh migrations, typecheck, lint, server tests, browser tests, dependency audit, security review, backup/restore, and provider sandbox acceptance all pass;
- institutional privacy, correctional-policy, retention, and operational approvals are recorded.
