# SecureVisit Current Project Audit — 2026-10-13

## Executive verdict

SecureVisit is now a substantial persisted workflow prototype and a credible
staging candidate. It is not production-ready and must not be opened to real
visitors, real money, or institutional staff yet.

The repository proves a large amount of domain behavior locally. It does not
prove that the same workflow works with real email/SMS, an institutional
identity provider, a payment provider, a protected evidence store, physical
kiosk hardware, or a real LiveKit project. Those are release blockers, not
polish items.

### Evidence captured on this audit

`npm run build`, `npm run test:e2e`, and `npm run test:quick` passed on commit `91431e7` and verified:

- 75 API route files covered by the security matrix; 0 uncovered routes.
- Fresh local D1 migration and synthetic seed verification.
- Disposable staging-fixture schema compatibility.
- Local backup/restore drill with schema, foreign-key, credit-ledger, and audit-integrity checks.
- TypeScript typecheck, ESLint, and production build.
- 589 server test cases and 18 browser tests.
- Production dependency audit with 0 vulnerabilities.
- Waiting Room provider-failure logging with request ID and redacted error reason.
- Versioned weekly operating hours with closed-day and weekday-specific validation
  shared by visitor availability, rescheduling, and staff approval.

`npm run audit:pilot` reports `readyForPilot: false`. Development currently
waives visitor email, visitor SMS, staff federation, payments, LiveKit, and
evidence scanning. The audit also has no HTTPS public domain or remote D1
identity configured, which is correct for local development but disqualifies a
pilot deployment.

## Current assessment

| Area | Assessment | Meaning |
| --- | --- | --- |
| Product/UI | 80% | Distinct visitor, control, kiosk, and management surfaces exist; some operational administration remains incomplete. |
| Frontend workflow | 70% | Major states and failure views exist, but real-provider browser acceptance is absent. |
| D1/domain foundation | 60% | Strong schema, scoping, transactions, idempotency, audit, and recovery concepts; remote resilience is unproven. |
| Visitor journey | 50–55% | Persisted local journey exists; external authentication, payment, and real completion are not proven together. |
| Staff operations | 60–65% | Appointments, Waiting Room, incidents, resources, finance, and audit boundaries exist; institutional operations are not signed off. |
| Authentication | 40–45% | OTP and federation boundaries are implemented; real IdP, MFA, recovery, and revocation evidence is missing. |
| Payments | 30–35% | Provider-neutral ledger and Xendit adapter exist; no sandbox settlement/reconciliation evidence exists. |
| Live video | 40–50% | Visitor, kiosk, observer, token, expiry, webhook, and failure boundaries exist; three-party staging proof is missing. |
| Security/operations | 40–45% | Application controls are substantial; deployed WAF, monitoring, secrets, backup, and independent review are missing. |
| Institutional pilot readiness | 30–35% | Not a go-live candidate. |

## What is implemented and evidenced

- Cloudflare Worker/Vinext application with same-origin APIs.
- D1 migrations, facility-scoped records, local seed, and transaction tests.
- Visitor email/SMS OTP structure with hashing, expiry, attempt limits, rate limits,
  sessions, revocation, device labels, and suspicious-login signals.
- Visitor profile, prisoner relationship, manual verification, and evidence
  metadata boundaries.
- Appointment availability, policy checks, approval/rejection/cancellation/
  rescheduling, resource reservation, and status history.
- Append-only credit ledger foundations, payment intents, signed webhook
  processing, replay protection, refund foundations, and finance recovery views.
- Waiting Room state machine, visitor/kiosk device checks, presence TTLs,
  kiosk credential lifecycle boundaries, and staff actions.
- LiveKit token/session boundaries, observer authorization, provider webhook
  handling, expiry/termination paths, and recording kept disabled.
- Notification outbox, delivery attempts, retries/dead-letter concepts, audit
  records, export manifests, retention, legal holds, break-glass boundaries,
  incidents, lockdown state, and durable reconciliation alarms.
- CSP and camera/microphone policy support for a configured LiveKit host.
- Release verifier, deployment validator, route security matrix, local restore
  drill, browser smoke tests, and redacted operational logging.

## What is not implemented, or is only code-ready

### P0 — blocks any institutional pilot

1. **Real visitor messaging.** Configure and test a real email provider and
   either a real SMS provider or an explicitly approved email-only scope. Prove
   delivered OTPs, bounce/invalid-recipient handling, provider callbacks,
   retries, dead-letter, outage recovery, account recovery, and device/session
   management.
2. **Institutional staff identity.** Connect both required OIDC and SAML
   providers, institutional MFA, group-to-role and facility mapping, disabled
   account denial, logout/revocation, and step-up authentication. Unit tests are
   not IdP acceptance evidence.
3. **Approved commercial policy.** Obtain signed Indonesian tariff,
   cancellation, no-show, technical-failure, expiry, dispute, and refund rules.
   Until then, the displayed Visit Credit price is not a valid product price.
4. **Payment provider.** Configure one sandbox provider, exercise checkout,
   signed callbacks, duplicate/delayed events, expiry, refund, dispute and
   chargeback handling, settlement reconciliation, and ledger invariants.
5. **Evidence storage.** Bind private staging/production R2 buckets and a
   malware scanner with quarantine, timeout/failure handling, authorized access,
   retention deletion, legal hold, and restore evidence.
6. **Kiosk reality.** Enroll one real controlled device; prove secure secret
   storage, rotation, revocation, replacement, offline/reconnect recovery, and
   camera/microphone/network troubleshooting.
7. **Three-party video.** Run visitor, kiosk, and staff observer in the same
   staging LiveKit room. Prove join, presence, reconnect, provider disconnect,
   expiry, staff termination, completion, credit settlement/refund, audit, and
   notifications. Local test transport is not media proof.
8. **Deployed resilience.** Perform remote D1/R2 backup and isolated restore,
   measure RPO/RTO, and verify ledger and audit integrity after recovery.
9. **Perimeter and operations.** Deploy Cloudflare WAF/bot/rate limits,
   dashboards, alert routing, secret rotation, on-call ownership, and alarms for
   auth abuse, provider failure, queues, stale sessions, database health, and
   dead letters.
10. **Independent and institutional approval.** Complete an independent
    security review/penetration test plus Indonesian privacy, retention,
    correctional-policy, identity-verification, tariff, and refund approvals.

### P1 — required before calling the product finished

- Replace remaining static or intentionally disconnected management surfaces
  with real APIs or explicitly remove them from the pilot navigation.
- Split the large Control `app/page.tsx` into feature modules and shared
  primitives to reduce regression and ownership risk.
- Finish operational replay tooling, delivery-provider reconciliation screens,
  staff provisioning procedures, and incident runbooks.
- Make the visitor journey refresh-safe against real provider states, not only
  local browser fixtures.
- Define service ownership and SLAs for verification, failed payments,
  notification failure, video failure, no-show, dispute, and privacy requests.
- Keep recording disabled. A recording feature requires a separate approved
  consent, encryption, access, retention, legal-hold, and audit design.

## End-to-end workflow that must be proven

```text
Visitor passwordless sign-in
  → verified profile and prisoner relationship
  → staff identity/relationship approval
  → approved tariff and provider checkout
  → signed payment settlement and Visit Credit ledger entry
  → appointment request and policy validation
  → staff decision and atomic room/kiosk/credit reservation
  → visitor device check and Waiting Room presence
  → kiosk enrollment/heartbeat and prisoner presence
  → staff admission after every readiness check passes
  → visitor + kiosk + staff observer in one LiveKit session
  → reconnect/outage/termination handling
  → completion settlement or policy-based release/refund
  → receipt, notification, incident if needed, and immutable audit evidence
```

The acceptance test must repeat the journey after refreshes and duplicate
requests, and must include delayed webhooks, provider outage, stale presence,
resource collision, kiosk replacement, unauthorized access, and restore.

## Finish sequence

1. **Freeze local behavior and baseline.** Keep the current release verifier
   green; do not treat local adapters or fictional seed data as staging proof.
2. **Create isolated staging.** HTTPS domain, remote D1, private R2, queues,
   secrets, logging, WAF, and deployment validator; run migrations and fixture.
3. **Messaging and identity.** Provider delivery evidence first, then real OIDC
   and SAML/MFA acceptance with facility/role claims.
4. **Policy and finance.** Obtain signed tariff/refund decisions, configure the
   provider sandbox, and reconcile all settlement branches.
5. **Hardware and video.** Enroll one kiosk, configure LiveKit, execute the
   three-party journey, and capture provider failure/recovery evidence.
6. **Resilience and operations.** Rehearse backup/restore, outage runbooks,
   alerts, secret rotation, retention, and replay/dead-letter recovery.
7. **Review and pilot decision.** Independent security review, privacy and
   correctional approval, owner sign-off, release manifest, rollback rehearsal,
   and a formal go/no-go decision.

## Honest go/no-go decision

**NO-GO for production or real institutional visitors.**

**GO for continued local engineering and controlled synthetic staging work.**

The repository is healthy enough to start the staging vertical slice. The next
meaningful progress cannot be obtained by more mock UI or local tests alone; it
requires named owners, real provider credentials/accounts, a staging facility,
one kiosk, measured recovery evidence, and institutional approvals.
