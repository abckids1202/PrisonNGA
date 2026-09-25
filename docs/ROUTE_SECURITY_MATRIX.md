# SecureVisit API Security Matrix

This matrix is the release-review index for the current API surface. “Implemented” means the route contains the corresponding repository guard; it does not mean the external provider or institutional staging test is complete.

| Route family | Identity | Facility scope | Mutation safety | Audit / operational evidence | Remaining proof |
| --- | --- | --- | --- | --- | --- |
| `/api/auth/visitor/request` | Public request; destination-bound challenge | Derived from the visitor workflow, no facility selected | Per-destination/IP rate limits; delivery attempt record | Delivery attempt; failed-code security events on verification | Real email/SMS adapter, provider delivery and abuse monitoring |
| `/api/auth/visitor/verify` | One-time visitor OTP | User account scope | Challenge expiry, attempt cap, one-time consumption | Visitor login, failed-challenge, and privacy-safe new-device security events | Production delivery, suspicious-login response and cookie/domain staging |
| `/api/auth/sessions` | Visitor session or staff federation session | User scope | Idempotent single/all-session revocation | Session revocation security event | Device naming, access-review operations and production session policy |
| `/api/auth/staff/oidc/*` | OIDC state/nonce/code-verifier flow | Staff profile facility scope | Single-use federation state | Staff login/security events | Institutional IdP, MFA, claims and logout/revocation staging |
| `/api/auth/staff/saml/*` | Signed SAML assertion plus D1-bound request state | Staff profile facility scope | Single-use federation state and assertion replay protection | Staff SAML login event | Institutional metadata rotation, MFA and logout/revocation staging |
| `/api/visitor/profile` | Authenticated visitor session | Visitor user scope | Versioned profile write | Audit/outbox on mutation | Production contact-verification and privacy review |
| `/api/visitor/relationships` | Authenticated visitor session | Relationship facility scope | Idempotent relationship submission | Relationship audit/outbox and decision history | Verification expiry/renewal policy and staging review |
| `/api/visitor/verification/evidence` | Authenticated visitor session | Case ownership and case facility | Content/type/size validation, duplicate digest handling | Evidence audit/outbox and retention metadata | Protected bucket, malware scanner, signed staff access and deletion drill |
| `/api/visitor/appointments*` | Authenticated visitor session | Appointment ownership and facility | Idempotency, version checks, policy/availability checks | Appointment status history and audit/outbox | Full concurrent booking/reschedule browser journey |
| `/api/visitor/prisoners`, `/api/visitor/appointment-types` | Authenticated visitor session | Facility selector, operational facility and published policy | Read-only | No mutation; facility-scoped response | Facility lockdown and policy-change staging observation |
| `/api/visitor/payments*` | Authenticated visitor session | Payment intent ownership/facility | Idempotent checkout; ledger is webhook-authoritative | Checkout/payment events, ledger and receipt | Real provider sandbox, refund/dispute/reconciliation staging |
| `/api/visitor/notifications` | Authenticated visitor session | Visitor user and facility | Idempotent read state | Notification/outbox delivery attempts | Real channel delivery and receipt verification |
| `/api/visitor/visits/*/live-session` | Authenticated visitor session | Appointment/session ownership | Session status/expiry checks | Session participant and finalization events | Three-party LiveKit staging and reconnect testing |
| `/api/control/appointments` | Staff workspace identity + appointment permission | Staff profile facility | Expected version, idempotent decision, transactional allocation/credit | Decision history, audit and outbox | Concurrent approval and provider-backed staging |
| `/api/control/waiting-room` | Staff workspace identity + waiting-room permission | Staff profile facility | Expected version and command idempotency | Waiting-room audit/outbox and incident hooks | Real visitor/kiosk presence and operational recovery |
| `/api/control/live-sessions*` | Staff permission; observer token is role-limited | Session facility | Idempotent end/terminate and version checks | Session/audit/outbox and settlement | Real observer client, provider webhooks and outage rehearsal |
| `/api/control/resources` | Staff resource permission | Staff profile facility | Expected resource/waiting versions; idempotent reassignment and kiosk credential lifecycle replay | Resource status/reassignment/credential audit | Real device enrollment, heartbeat and recovery procedure |
| `/api/control/verification*` | Staff verification permission; approved break-glass grant may be used for evidence retrieval | Case/document facility | Version/idempotency on decisions; time-bound emergency grant | Review decision history, direct evidence-access audit, and break-glass audit/outbox trail | Institutional review policy and protected evidence staging |
| `/api/control/finance` | Staff finance-read permission | Staff profile facility | Read-only | Ledger/reconciliation issue visibility | Provider reconciliation and finance-operational sign-off |
| `/api/control/notifications/outbox` | Staff notification-operations permission | Staff profile facility | Idempotent replay | Delivery attempts and replay audit | Queue alerting, dead-letter runbook and real delivery |
| `/api/control/audit/export` | Staff audit/export permission + step-up where required | Staff profile facility | Export request is bounded and audited | Immutable export/audit trail | Integrity verification, retention and legal-hold procedure |
| `/api/control/audit/export/:exportId` | Staff audit-read permission | Staff profile facility | Read-only manifest lookup | Stored SHA-256 manifest metadata | Artifact custody and independent verification procedure |
| `/api/control/access/break-glass*` | Requester permission or supervisor approval permission + step-up | Staff profile facility and target record facility | Idempotent request/decision, version checks, bounded 5–60 minute grant | Request/decision/use/expiry audit and outbox events | Supervisor roster, emergency runbook, periodic access review |
| `/api/control/retention`, `/api/control/legal-holds` | Staff compliance permission + step-up | Staff profile facility | Idempotent, versioned, legal-hold aware | Audit/history and deletion evidence | Restore/rollback and legal approval |
| `/api/facility/state` | Staff facility-state permission + step-up for lockdown | Explicit facility scope | Expected version/idempotent state transition | Facility-state audit/outbox | Supervisor approval and emergency runbook |
| `/api/kiosk/*` | Kiosk credential bound to resource/facility | Credential/resource/appointment facility | Credential and device-check idempotency | Kiosk heartbeat/device/presence events | Controlled-device enrollment, secure credential storage and physical recovery |
| `/api/webhooks/payments` | Provider HMAC signature and replay window | Payment intent/provider scope | Event-key idempotency, amount/currency/reference checks | Provider event retry/dead-letter and ledger audit | Real provider signature and delayed/replayed event tests |
| `/api/webhooks/livekit` | LiveKit webhook signature | Room/session facility binding | Event reconciliation and participant upsert | Participant/session audit evidence | Real provider webhook delivery and outage tests |
| `/api/health/readiness` | Health endpoint; no business data | Runtime/schema/provider configuration | Read-only | Structured readiness response | Cloudflare deployment secrets, alert routing and backup checks |

## Release-review use

For every row, the reviewer must attach evidence from source, automated tests, and a staging observation. A route is not “pilot ready” when only the source guard exists. The final acceptance record must include:

1. A positive authorization test.
2. An unauthorized-user test.
3. A facility-isolation test where the route reads or writes facility data.
4. A duplicate/retry test for mutations.
5. An audit/outbox assertion for sensitive transitions.
6. A provider or operational failure test when the route depends on an external service.

The remaining external gates and canonical visitor/staff/kiosk workflow remain tracked in [INSTITUTIONAL_PILOT_AUDIT.md](./INSTITUTIONAL_PILOT_AUDIT.md).
