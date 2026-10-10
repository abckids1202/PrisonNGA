# SecureVisit Production Operations Runbook

Status: Draft — requires platform, security, facility, and institutional approval before pilot use.

This runbook defines how operators detect, contain, recover from, and evidence failures in a single-facility SecureVisit deployment. It is deliberately operational: a green local test suite is not a substitute for completing the exercises named here.

## 1. Roles and severity

Assign these roles before staging acceptance:

- Incident commander: owns the decision, timeline, communications, and go/no-go status.
- Platform owner: Cloudflare Worker, D1, R2, Queue, WAF, secrets, deployment, and restore actions.
- Facility operations owner: admissions, kiosk, room allocation, lockdown, and visitor support decisions.
- Finance owner: payment, credit, refund, dispute, and reconciliation decisions.
- Security/privacy owner: access review, evidence, legal hold, security events, and regulator/institution notifications.

Severity levels:

| Level | Example | Initial target | Required action |
| --- | --- | ---: | --- |
| SEV-1 | Unauthorized access, cross-facility exposure, ledger corruption, or facility-wide outage | 15 minutes | Freeze affected workflow, preserve evidence, incident commander and security owner engaged |
| SEV-2 | Payment/notification/video provider outage, repeated dead letters, or kiosk fleet failure | 30 minutes | Degrade safely, open incident, notify affected staff and visitors |
| SEV-3 | Single visit, device, or non-critical management failure | 4 hours | Record case, retry or manually recover, review before closure |
| SEV-4 | Cosmetic or reporting defect without workflow impact | 2 business days | Track in normal engineering backlog |

Never resolve an incident solely because the provider recovered. Confirm persisted state, audit evidence, notifications, and reconciliation first.

## 2. First response checklist

1. Open a facility-scoped incident with severity, start time, reporter, affected capability, and correlation/request IDs.
2. Stop the smallest affected workflow. Do not use a global lockdown for a provider-specific failure unless the facility policy requires it.
3. Preserve logs, audit events, webhook IDs, payment references, session IDs, and screenshots. Do not copy OTPs, credentials, raw identity evidence, or payment secrets into the incident.
4. Check `/api/health/live` for liveness and authenticated `/api/health/readiness` for dependency/configuration status.
5. Check the relevant persisted queue, reconciliation, audit, and security-event records before retrying anything.
6. Use the original idempotency key or provider event key when retrying. Never create a new business action to “make the UI succeed.”
7. Record the recovery result and link the incident to the affected appointment, payment, session, resource, or evidence record.

## 3. Database and migration operations

### Routine checks

- Apply reviewed migrations to staging first: `npm run db:migrate:remote` with an explicitly selected non-development environment.
- Confirm the migration list, schema readiness, foreign-key integrity, credit-ledger invariants, and audit row counts.
- Never run an unreviewed SQL mutation directly against production.

### Backup and restore drill

1. Announce a maintenance window and capture the current deployment commit and migration list.
2. Create a remote D1 backup using the approved platform procedure; store it in protected operator storage with an immutable evidence ID.
3. Restore into an isolated database, never directly over the live database.
4. Run schema, foreign-key, facility-scope, credit-ledger, payment-event, appointment-resource, and audit-integrity checks.
5. Measure RPO (latest recoverable committed timestamp) and RTO (restore-to-validated-service time).
6. Record the backup identifier, restore target, commands, timings, failures, and operator sign-off in the evidence register.
7. Delete the isolated restore only after evidence is retained according to policy.

Do not claim disaster recovery readiness from the local `db:restore:drill` alone. A remote D1 and R2 exercise is required.

### Migration rollback

Prefer a forward corrective migration. If a deployment must be rolled back, keep the database at its current compatible schema and deploy an application version that can read it. Do not use destructive reset commands against a shared database.

## 4. R2 evidence and malware scanning

1. Keep evidence buckets private; expose objects only through the authenticated staff route with facility, permission, legal-hold, retention, and digest checks.
2. A new upload remains unavailable until the scanner returns a signed clean result.
3. On malware, timeout, malformed response, or scanner outage, keep the object quarantined, create the required security/privacy signal, and tell staff that verification cannot proceed.
4. For retention deletion, verify the database claim is `PENDING_DELETION`, re-check legal holds, delete the object, then commit the terminal database state.
5. If object deletion fails, restore the claim for retry and keep the evidence unavailable to ordinary review until the failure is resolved.
6. Test unauthorized object reads, replacement/corruption digest mismatch, legal hold, deletion retry, and isolated restore before pilot approval.

## 5. Email and SMS outage

Symptoms include delivery-attempt failures, provider callback failures, dead letters, or a rising OTP failure rate.

1. Confirm the provider status and inspect delivery attempts without exposing destination values.
2. Do not extend OTP expiry or reveal a development OTP in staging/production.
3. Keep the challenge unavailable when a terminal delivery failure is recorded.
4. Retry through the outbox with bounded backoff; replay only after confirming the provider and recipient policy allow it.
5. If delivery remains unavailable, show visitors a support path and record the incident. Do not mark an appointment, verification case, or payment notification as delivered.
6. After recovery, verify one controlled email and SMS, provider callbacks, delivery state ordering, dead-letter recovery, and duplicate suppression.

## 6. Payment provider outage or discrepancy

1. Stop new checkout if readiness or provider health indicates the provider is unavailable; do not accept money into a local-only path.
2. Leave payment intents pending until an authenticated provider event or approved reconciliation decision confirms the result.
3. Match provider event ID, provider reference, amount, currency, and payment intent before any ledger mutation.
4. For duplicate or delayed webhooks, reuse the event key and allow the idempotent handler to acknowledge the existing result.
5. For a dispute or chargeback, do not manually edit balances. Create the provider event, reconciliation issue, audit record, and finance incident, then apply the approved policy.
6. For refunds, verify the supervisor step-up, policy approval, reserved/available balance, provider acceptance, and final webhook before communicating completion.
7. Reconcile provider settlement reports against payment intents and the append-only credit ledger before reopening checkout.

## 7. LiveKit outage and session recovery

1. Confirm the provider status, Worker error rate, webhook delivery, and session reconciliation records.
2. Keep visits in an explicit waiting, reconnecting, ended, or recovery-required state. Never mark a visit complete from browser state alone.
3. Do not consume a credit unless the persisted session evidence proves both required participants joined and the terminal finalization committed.
4. If room deletion fails, preserve the session and create the durable provider-close alarm; retry through scheduled reconciliation.
5. If a session is abandoned, verify stale-session cleanup, resource release, presence cleanup, credit outcome, audit evidence, and visitor notification.
6. Before reopening LiveKit admission, run a controlled visitor/kiosk/staff observer call, disconnect/reconnect test, expiry test, termination test, and webhook replay test.

## 8. Kiosk and facility-device recovery

1. Mark the device offline/failed through the persisted resource workflow; do not reuse a stale credential.
2. Reassign an active appointment only through the optimistic-concurrency and idempotent resource-reassignment action.
3. If a credential may be exposed, revoke it immediately, issue a new one through the step-up-protected rotation flow, and record the physical custodian and device serial/reference in the facility procedure.
4. Clear stale prisoner presence only through the authenticated kiosk absence boundary or staff recovery action.
5. On replacement, verify device enrollment, camera, microphone, network, heartbeat, kiosk device check, assigned room, and audit trail before admitting a visit.

## 9. Identity and access incidents

- If OIDC/SAML is unavailable, stop new staff sign-in and use only the institution-approved break-glass procedure.
- Do not restore workspace identity headers outside explicit development mode.
- Revoke compromised staff sessions from Access Review and record the reason, actor, and time.
- For suspected cross-facility or privilege leakage, declare SEV-1, preserve evidence, disable the affected route or deployment, and involve the security/privacy owner before reopening.
- Review MFA claims, issuer/audience, SAML request correlation, role mapping, facility scope, and session revocation after recovery.

## 10. Lockdown and controlled degradation

Use facility lockdown only according to the approved correctional policy. The policy must state whether active sessions continue, whether waiting visitors are admitted, how approved visits are rescheduled, who may restore operations, and when credits are refunded.

During a restriction:

- Block new admissions and new visitor discovery as required by policy.
- Preserve authoritative appointments and live-session records for staff review.
- Allow safe presence clearing so abandoned browsers/devices do not remain present.
- Send only approved, facility-safe visitor communications.
- Record the state transition, reason, supervisor approval if required, affected records, and restoration decision.

## 11. Deployment rollback

1. Freeze further deployments and identify the last known-good commit.
2. Check database compatibility before rolling back the Worker.
3. Prefer disabling the affected capability through an approved configuration/policy boundary rather than reverting schema state.
4. Run liveness, readiness, authenticated staff access, visitor access, and one non-money test workflow after rollback.
5. Reconcile in-flight payments, notifications, sessions, and outbox claims before closing the incident.
6. Record deployment ID, commit, migration state, operator, timings, and validation evidence.

## 12. Secret rotation

Rotate through the platform secret manager, never through committed files or chat:

- LiveKit API secret and webhook secret
- Payment provider and webhook secrets
- Email/SMS provider credentials
- OIDC client secret
- SAML signing/trust material and metadata certificate
- Evidence scanner secret
- Step-up and hash-salt secrets according to the approved rotation policy

Use an overlap window when the provider supports dual keys. Validate outbound signing, inbound verification, provider callbacks, and rollback before revoking the old key. Record the secret version and validation evidence, never the secret value.

## 13. Monitoring and alert acceptance

The deployed environment must alert on:

- Worker 5xx rate, latency, and rejected requests
- Authentication abuse, OTP failures, and suspicious logins
- Payment webhook failures, disputes, reconciliation gaps, and refund backlog
- Notification failures, retries, and dead letters
- LiveKit webhook failures, stale sessions, reconnect storms, and provider-close failures
- D1 errors, migration failures, backup age, and restore failures
- R2 scanner failures, retention deletion failures, legal-hold conflicts, and unauthorized access
- Offline/failed kiosks and resource reassignment conflicts

For every alert, perform one synthetic or controlled test, capture acknowledgement time and recovery time, and link the result to the pilot evidence register.

## 14. Required exercises before pilot approval

- Remote D1 backup and isolated restore with measured RPO/RTO
- R2 quarantine, authorized read, legal hold, deletion, and restore exercise
- Email/SMS provider outage and recovery exercise
- Payment duplicate, delayed, failed, refund, dispute, and reconciliation exercise
- Three-party LiveKit disconnect, expiry, termination, and provider-outage exercise
- Kiosk enrollment, rotation, revocation, replacement, and offline recovery exercise
- OIDC/SAML MFA, disabled-account, role-mapping, and session-revocation exercise
- WAF/rate-limit false-positive and abuse-path exercise
- Deployment rollback and secret-rotation exercise
- Tabletop incident-response and institutional go/no-go review

Evidence from these exercises belongs in `docs/PILOT_EVIDENCE_REGISTER.md`. Until the corresponding records are marked verified by the named owner, the deployment remains a staging system and must not accept real correctional visitors or real money.
