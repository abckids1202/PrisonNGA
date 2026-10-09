# SecureVisit Current Project Audit

Date: 2026-10-09

Latest verified code baseline: `9813746 feat: alarm on evidence retention failures`

Audit update: 2026-10-09

The route-boundary review found no protected application API route that is
obviously missing an identity, permission, visitor, kiosk, webhook, health, or
environment boundary. Facility settings are also backed by the current
facility-policy, closure, restriction, and resource APIs; the `NOT CONNECTED`
state is a fallback for unknown settings tabs, not the active implementation.

The most important newly confirmed implementation risk is transactional
correctness under concurrency. Several workflows use D1 `batch()` statements
that write related records and then inspect `meta.changes` after the batch has
already executed. A zero-row optimistic-concurrency result is handled in
application code, but D1 does not automatically roll back a successful earlier
statement merely because a later statement changed zero rows. The kiosk
presence path is a concrete example: the waiting-room row can be updated while
the appointment update loses its version race. This requires an atomic
transition design or a tested reconciliation/compensation strategy before
production use; passing local tests does not prove this race is safe.

The current code baseline adds bounded compensation for the confirmed
waiting-room cases (visitor presence, kiosk presence, and kiosk device-check
evidence). If a related optimistic-concurrency write loses its race, the first
write is restored while its incremented version is still owned by the request;
failure to restore returns an explicit reconciliation-required error. This
reduces the risk but does not replace a staging concurrency test against remote
D1.

The staff Waiting Room transition now persists `last_transition_id` on the
appointment before credit/resource cleanup guards execute. This closes a
previous cancellation defect where the visit could be marked cancelled while
the guarded cleanup statements matched zero rows.

This document is the current project-lead assessment of the repository. It distinguishes implemented code from provider or institutional evidence that cannot be proven locally.

## Local development

```powershell
cd C:\Users\charl\OneDrive\Desktop\PrisonNGA
npm install
npm run db:migrate:local
npm run db:seed:local
$env:PORT=5174
npm run dev:local
```

Open `/visitor`, `/control`, or `/kiosk` at `http://localhost:5174`. The application uses same-origin API routes; a second backend on port 8001 is not part of the current architecture.

Validation commands:

```powershell
npm run typecheck
npm run lint
npm test
npm run verify:release
```

## Current verdict

SecureVisit is a substantial, production-structured prototype suitable for continued development and controlled staging. It is not yet an institutional production release.

Approximate readiness:

| Area | Assessment |
| --- | --- |
| Product and visual direction | Strong prototype |
| Visitor workflow | Partially persisted; full journey not proven |
| Control and operations | Substantial foundations; some management surfaces remain incomplete |
| Database and domain model | Real local D1 foundation with migrations |
| Authentication | Development visitor OTP; institutional federation not validated |
| Payments | Provider-neutral adapter; no real provider evidence |
| Live video | LiveKit foundations; three-party staging evidence missing |
| Production operations | Release gates incomplete |

## Implemented evidence

- Local D1 migrations and seeded facility data.
- Facility-scoped visitor, prisoner, relationship, verification, appointment, resource, waiting-room, session, credit, payment, incident, audit, retention, and notification records.
- Idempotency and optimistic-concurrency protections across important mutations.
- Visitor OTP development flow and protected visitor routes.
- Staff appointment decisions, resource-health checks, waiting-room readiness, kiosk/device checks, and LiveKit session foundations.
- Payment-intent, signed webhook, refund-request, dispute, and ledger foundations.
- Durable outbox processing, retries/dead-letter handling, replay endpoint, and scheduled reconciliation hooks.
- Fail-closed environment validation for staging and production.
- Liveness and staff-authorized readiness checks.
- Request IDs, correlation IDs, bounded provider responses, rate-limit retry guidance, and facility-state handling.
- Centralized delivery-provider readiness checks for webhook, Resend, Twilio, and development channels.
- Production payment signing secrets are rejected unless they meet the minimum entropy length.
- Automated server/unit tests and browser-level journey coverage for local adapters.

The current local evidence baseline is **459 application tests passing**, with typecheck, lint, production build, fresh local D1 migration verification, 17 browser tests, and production dependency audit passing in the release verifier on `9813746`. Staff Waiting Room, resource-reassignment, kiosk credential, notification dead-letter, payment reconciliation dead-letter, LiveKit provider-close failure, blocked-finalization, and evidence-retention deletion-failure gaps now create durable critical reconciliation/privacy signals for follow-up. Compliance can create a replay-safe incident directly from those alarms, and the security-event-to-incident relationship is persisted and returned after refresh. Production readiness also fails closed until institutional release-gate attestations are present, and Administration exposes those gates to operators. This proves repository behavior only; it does not prove external provider delivery, institutional identity, hardware, resilience, or policy approval.

A disposable local backup/restore drill also passed after the release verification, including schema, foreign-key, credit-ledger, and audit-integrity checks. This is local recovery evidence only; remote D1 backup scheduling, R2 recovery, RPO/RTO measurement, and a production-like restore exercise remain release gates.

## Not yet proven or still incomplete

### External identity and communication

- Real visitor email delivery and SMS delivery.
- Visitor recovery, session/device management, and suspicious-login operations in a real provider environment.
- OIDC and SAML integration with an institutional identity provider and enforced MFA.
- Staff provisioning, deprovisioning, role mapping, and session revocation against real accounts.

### Money and policy

- Approved Indonesian tariff.
- Approved cancellation/refund policy.
- Real payment-provider sandbox checkout.
- Provider webhook, refund, dispute, and reconciliation staging evidence.
- Facility-effective pricing is now stored in the versioned Visit Policy and exposed to the checkout boundary; finance still must approve the tariff and refund policy before activation.

### Files and privacy

- Protected production R2 bucket.
- Malware scanner deployment and quarantine workflow.
- Signed evidence access and retention/deletion verification in production.
- Backup and restore evidence for database and object storage.

### Kiosk and live visit

- Hardware kiosk enrollment, device identity, credential rotation, revocation, and recovery.
- Visitor, kiosk, and staff observer joining the same LiveKit session in staging.
- Network/camera/microphone failure recovery with real hardware.
- Abandoned-room reconciliation and end-to-end credit settlement evidence.

### Operations and governance

- WAF and deployed rate-limit configuration.
- Monitoring, alerting, secret rotation, and outage runbooks.
- Independent security review.
- Indonesian privacy and correctional-policy approval.
- Staff training and a controlled-facility acceptance sign-off.

## Critical product flaws to resolve before launch

1. A screen must not be considered complete until its data is authoritative, facility-scoped, refresh-safe, and mutation-backed. Remaining static management content must be removed or clearly labeled as unavailable.
2. Development adapters and fictional seed data must never be reachable in staging or production. Environment validation must remain fail-closed.
3. Payment success must be webhook-confirmed; browser return pages must never mint credits.
4. Appointment approval, credit reservation, room/device reservation, admission, session start, completion, and refund must remain one auditable state machine with strict legal transitions.
5. Kiosk identity must be stronger than a URL or browser label. A lost or compromised device must be revocable without changing the appointment record.
6. Recording must remain disabled until consent, access approval, encryption, retention, legal hold, and audit controls are separately approved.
7. Provider failure must leave a visible recoverable state, never an implied success or silent cancellation.
8. A green local test suite is not proof of institutional readiness. Provider, hardware, restore, security, and policy evidence are release gates.

## Finish sequence

1. Free local disk space and obtain a clean full-suite baseline.
2. Remove remaining visitor demo-state dependencies and prove refresh-safe visitor verification, payment, appointment, waiting-room, live-session, and receipt behavior.
3. Configure real email/SMS and institutional OIDC/SAML/MFA in staging.
4. Select a payment provider, approve tariff/refund policy, and complete sandbox reconciliation tests.
5. Deploy protected R2 and malware scanning; verify retention and deletion.
6. Enroll and rotate real kiosk credentials; run the three-party LiveKit acceptance journey.
7. Replace remaining static management data with authoritative APIs and finish notification/incident/audit operations.
8. Run backup/restore, WAF/rate-limit, monitoring, secret-rotation, outage, and security-review exercises.
9. Complete legal/privacy/correctional approvals and facility acceptance testing.
10. Release only when the complete workflow survives refreshes, duplicate requests, delayed webhooks, provider outages, unauthorized access attempts, and recovery drills.

## Release decision

Current decision: **No-go for institutional production; continue development and controlled staging.**

The project becomes pilot-ready only when the finish sequence has recorded evidence, not merely configuration placeholders or passing local tests.
