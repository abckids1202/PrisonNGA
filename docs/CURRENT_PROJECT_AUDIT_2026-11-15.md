# SecureVisit current project audit — 2026-11-15

## Executive decision

SecureVisit is a strong, production-structured repository and a controlled
synthetic-staging candidate. It is not yet an approved institutional pilot or
production service. The latest complete local release verification was run
against code commit `c75c83d` and passed 744 release tests, 19 browser tests,
typecheck, lint, production build, fresh D1 migration checks, a disposable
backup/restore drill, route-security coverage, and the production dependency
audit.

The verification result remains repository evidence only, not a claim that
external services have been tested.

## What is implemented locally

| Area | Current evidence | Assessment |
| --- | --- | --- |
| Tenant model | Organization/facility scope, membership roles, database tenant guards, facility-scoped queries | Implemented in repository; remote multi-facility deployment still unproven |
| Visitor identity | Email/SMS development adapters, OTP expiry/attempt limits, session/device management, revocation, provider readiness checks | Implemented as boundaries; real email delivery and recovery require staging evidence |
| Staff identity | OIDC and SAML flows, MFA claim requirements, role/facility mapping, step-up controls | Implemented as integration boundaries; institutional IdP validation remains open |
| Verification | Relationship cases, evidence metadata, private-storage abstraction, malware-scan callback boundary, staff decisions, retention/legal hold | Persisted workflow implemented; R2 and scanner are not externally proven |
| Credits/payments | Append-only ledger, transactional reservation/release, current Xendit Payment Session/refund adapter, signed webhook normalization, refunds, disputes, reconciliation recovery | Adapter and invariants tested; no real Xendit sandbox evidence yet |
| Appointments | Availability, policy snapshots, approval checks, collision prevention, resource and credit reservation, cancellation/reschedule branches | Persisted workflow implemented and browser-tested locally |
| Waiting Room/kiosk | Persisted readiness facts, presence TTLs, device checks, kiosk credentials, heartbeat, admission commands, retries and alarms | Repository workflow implemented; real enrolled hardware remains unproven |
| Live video | Local transport plus LiveKit token/session/webhook/egress boundaries, visitor/kiosk/observer clients, termination and settlement logic | Local simulation is testable; a real three-party LiveKit call is not yet proven |
| Recordings | Consent, policy enforcement, dedicated R2 bucket requirement, encrypted-storage control reference, integrity checks, audited range playback, retention and legal hold | Governed implementation exists; real LiveKit Egress/R2 playback evidence remains open |
| Operations | Outbox, retries/dead letters, scheduled reconciliation, durable alarms, incidents, audit exports, readiness endpoint, release gates | Repository operations are implemented; deployed monitoring/WAF/recovery evidence remains open |

## Release blockers

These cannot be honestly completed by local code changes alone:

1. HTTPS staging and production domains, separate Vercel/Worker environments,
   remote D1, R2 buckets, Queues, secrets, and rollback evidence.
2. Real visitor email delivery and callback testing. SMS must either be
   configured with an approved provider or explicitly excluded from the pilot.
3. Institutional Entra OIDC and SAML federation with MFA, claims mapping,
   disabled-account denial, and session-revocation evidence.
4. Approved Indonesian tariff, cancellation, no-show, refund, dispute, and
   recording-policy decisions.
5. Xendit Test Mode checkout, delayed/duplicate/conflicting webhook, refund,
   dispute, reconciliation, and provider-outage evidence.
6. Private R2 evidence and recordings buckets plus malware scanning, quarantine,
   retention deletion, legal hold, restore, and access-review evidence.
7. One real kiosk enrollment, credential rotation/revocation, heartbeat,
   offline recovery, camera/microphone/network checks, and replacement drill.
8. A real staging LiveKit test with visitor, kiosk, and staff observer,
   reconnects, termination, settlement, recording consent, private playback,
   retention, and legal hold.
9. Deployed WAF/rate limits, monitoring/alert acknowledgement, secret rotation,
   backup/restore measurements, and outage tabletop exercises.
10. Independent security review, Indonesian privacy/correctional-policy review,
    and formal institutional go/no-go approval.

## Honest video-call answer

The video-call feature is implemented at the application boundary, not proven
as a real provider service. Local development uses an explicit `local_test`
transport and the browser suite exercises persisted session transitions. A
real call is only established when `VIDEO_PROVIDER=livekit`, valid LiveKit
credentials, the browser permissions policy, the LiveKit webhook, and the
visitor/kiosk/observer clients are tested together in staging. Until that test
exists, the correct status is **not yet production-proven**.

## Finish order

1. Provision isolated staging and run remote migrations.
2. Configure email-first visitor authentication and institutional staff IdPs.
3. Obtain and encode approved tariff, refund, and recording policies.
4. Execute Xendit sandbox acceptance and reconciliation.
5. Configure R2/scanner and run evidence/recording lifecycle tests.
6. Enroll one kiosk and run the full three-party LiveKit journey.
7. Rehearse recovery, monitoring, WAF, secret rotation, and provider outages.
8. Complete independent security and institutional reviews.
9. Produce the signed staging/release evidence manifest and execute go/no-go.

No local test, demo adapter, or green build should be used to waive one of
these external gates.
