# SecureVisit Institutional Pilot Audit and Completion Plan

Date: 2026-09-25  
Scope: current repository, single-facility Indonesian pilot, Cloudflare Worker + D1 + LiveKit

## Executive verdict

SecureVisit is a strong persisted workflow prototype with meaningful security and failure-handling foundations. It is not yet an institutional production system. The remaining risk is concentrated in external integrations, multi-party staging proof, operational administration, and release assurance rather than in the basic page designs.

Current assessment:

| Area | Assessment | Meaning |
| --- | --- | --- |
| Product/UI concept | Strong | Distinct Control and Visitor workspaces exist and the major workflow screens are represented. |
| Persisted domain foundation | Moderate/strong | D1 schema, migrations, facility scope, state history, credit ledger, appointments, verification, waiting room, sessions, incidents, resources, kiosk credentials, retention and legal holds exist. |
| Business workflow | Moderate | The core path is represented and many transitions are guarded, but the complete visitor/staff/kiosk journey has not been proven against real providers together. |
| Security implementation | Moderate | Authorization, facility scope, idempotency, rate limits, security events, CSP and fail-closed readiness checks are present; institutional IdP, WAF, secret management and independent review are still external gates. |
| Production operations | Early pilot | Worker retries, outbox/dead-letter handling, scheduled reconciliation and structured logging foundations exist; monitoring, backups, restore drills, incident runbooks and operational replay still need deployment validation. |
| Launch readiness | Not ready | Do not accept real money or real correctional users until the release gates below pass in staging. |

## What is implemented

The current repository already includes:

- Facility-scoped D1 schema and migrations for users, staff roles, prisoners, visitors, relationships, verification, policies, appointments, resources, kiosks, waiting room, live sessions, incidents, notifications, payment intents, payment events, credit ledger, audit, retention and legal holds.
- Visitor email/SMS development OTP flows, visitor sessions, profile and relationship submission, evidence metadata, appointment and device-check APIs, credit display and payment-intent creation. Visitor, staff, verification, evidence, waiting-room, and LiveKit joins now enforce matching facility IDs, reducing cross-facility data-integrity risk.
- Persisted OTP delivery-attempt records with sent/failed status, provider label, sanitized failure code and scheduled cleanup; OTP values and destinations are not copied into the delivery-attempt table.
- Staff appointment decisions, verification decisions, waiting-room commands, live-session termination, facility policy mutation, staff provisioning, kiosk credentials, resource health, retention and legal-hold operations.
- Provider-neutral payment checkout boundary, signed payment webhook ingestion, duplicate-event protection, delayed-event retry and credit settlement/refund invariants.
- Authenticated visitor payment receipts that only expose a settled payment with a matching `PURCHASE` ledger entry.
- LiveKit token scopes, expiry, participant roles, session creation/finalization, stale-session reconciliation and recording disabled by policy.
- LiveKit participant tokens are now derived from each session's authoritative end time, capped at 30 minutes, and issued only for valid session windows; malformed windows fail closed instead of receiving an open-ended provider credential.
- LiveKit readiness and provider configuration now reject malformed URLs, non-HTTPS/WSS schemes, and credential-bearing URLs before a browser connection or provider client can be created.
- Staff evidence retrieval now verifies the stored object’s SHA-256 against the immutable evidence record before serving it, preventing a size-matching replacement or corruption from being presented as the submitted document.
- Staff LiveKit observer tokens now require both a joinable session and an `IN_PROGRESS` appointment, matching the visitor and kiosk lifecycle boundary.
- LiveKit webhook activation now requires a joined visitor or assigned facility/kiosk participant; staff observers and room-level telemetry cannot start a credit-consuming session or set its actual start time.
- LiveKit participant disconnects now move visitor/kiosk sessions into `RECONNECTING` for recovery, while observer disconnects remain telemetry-only.
- No-show reconciliation now treats presence as valid only when its persisted heartbeat timestamp is fresh, preventing disconnected clients from blocking terminal appointment cleanup.
- Scheduled cleanup now normalizes ISO-8601 application timestamps with SQLite `julianday()` before comparing them with the database clock, covering no-shows, abandoned payments, stale provider claims, evidence retention, expired sessions, and authentication artifacts.
- Payment-provider and notification-outbox retry claims now also normalize `available_at` through `julianday()`; ISO-8601 backoff timestamps can no longer be stranded by lexicographic comparison with SQLite's space-separated `CURRENT_TIMESTAMP`.
- Visitor suspicious-login detection now normalizes persisted session timestamps before its 30-day recognized-device lookup, so a valid recent device is not misclassified because of SQLite timestamp formatting.
- Live-session join/token issuance fails closed unless the persisted session explicitly remains `OFF` / `NOT_RECORDED`; legacy or malformed recording-enabled rows cannot join.
- Facility isolation checks, permission checks, step-up foundations, rate limits, security events, request/correlation identifiers, CSP and camera/microphone permissions policy.
- Idempotent state-changing boundaries for appointment decisions, verification review, visitor profile, session revocation, notification read state, policy updates, live-session ending, waiting-room commands, outbox replay and visitor payment checkout audit events.
- Privacy-safe `VISITOR_LOGIN_CHALLENGE_FAILED` security events with hashed request context and no OTP/destination logging.
- Visitor phone verification state is sourced from the authoritative user session record; profile reads and writes no longer invent verification timestamps or erase verified SMS state.
- Visitor prisoner and appointment-type discovery now requires a configured, normally operating facility, so direct API calls cannot expose operational records from a lockdown or unconfigured facility.
- Workspace identity headers are now accepted only in explicit development mode; staging and production require persisted staff sessions from OIDC or SAML.
- OIDC staff callbacks now require a configured `acr` and/or `amr` MFA claim; staging/production configuration fails closed when the claim requirement is missing.
- SAML staff callbacks now request and validate the configured `AuthnContextClassRef` from the signed assertion; staging/production configuration fails closed when it is missing.
- Failed OIDC and SAML callbacks now emit privacy-safe warning events with the provider, safe error category, request ID and hashed request context only; assertions, codes, tokens and identity payloads are never logged.
- The readiness endpoint now applies the same central fail-closed environment validator used by deployment configuration, including MFA, step-up, pricing, provider, storage and delivery requirements; it reports only missing configuration names and never secret values.
- Staff finance now has a supervisor-only, step-up-protected refund request boundary with idempotency, persisted request state, provider-neutral signed initiation, audit/outbox evidence, retryable provider failure, and webhook-driven completion.
- Finance reconciliation now surfaces pending and failed refund requests, while the outbox worker sends explicit requested, failed, completed, and disputed payment/refund notifications.
- Audit exports now persist a facility-scoped manifest containing the export actor, range, row count, stable export ID, and SHA-256 digest; the CSV response returns both identifiers for later integrity verification.
- Worker processing for outbox events, payment reconciliation, no-show/session cleanup, evidence retention and expired authentication/step-up cleanup.
- Development E2E now exercises checkout creation through a local-only provider adapter, signed payment webhook settlement, duplicate delivery, and one PURCHASE ledger entry; the adapter is unavailable outside development.
- Automated server tests and browser smoke tests. Current validation baseline is 301 server tests and 13 browser tests passing.
- A route-by-route security review index is maintained in [`docs/ROUTE_SECURITY_MATRIX.md`](./ROUTE_SECURITY_MATRIX.md), with separate source, test, provider and staging evidence requirements.

## What remains incomplete or unproven

### Release blockers requiring external configuration or approval

1. A real payment provider is not selected or configured. The webhook adapter is not proof that checkout, settlement, refund, dispute and reconciliation work with a real provider.
2. Real visitor email delivery and SMS delivery are not configured and tested. Development OTP codes must never be enabled in production.
3. Staff OIDC and SAML must be connected to the institution's IdP, including MFA, claims mapping, role provisioning, session revocation and failure behavior.
4. LiveKit visitor, kiosk and staff observer clients must be tested together in staging with real credentials, disconnects, expiry and provider outages.
5. Remote D1 migrations, backup, restore and recovery-time objectives must be tested. A clean local migration is not a production backup strategy.
6. Protected object storage, malware scanning, signed evidence access, retention deletion and legal holds must be configured and tested.
7. WAF/bot protection, deployment rate limits, managed secrets, monitoring and alert routing must be enabled in the actual Cloudflare environment.
8. Indonesian privacy, correctional policy, payment terms, consent, identity verification and incident procedures require institutional/legal approval.
9. An independent security review and a controlled pilot go/no-go review remain outstanding.

### Product and workflow gaps inside the repository

- The full browser journey is not yet a three-party test. Existing E2E tests cover the shell, OTP, persistence, kiosk boundary and session revocation, but not staff approval plus visitor device check plus kiosk presence plus LiveKit completion plus credit settlement.
- The unimplemented System Settings section is hidden from the pilot Administration navigation; it must be added only when its policy model, permissions, history and operational effects are implemented.
- Facility → Operating Hours and Visit Policies now open the authoritative persisted policy editor; Restrictions uses the facility-state API with reason capture and existing step-up/audit/idempotency enforcement; Closures uses the persisted closure workflow. Regression tests protect these entry points.
- Visitation now reuses the persisted policy editor for Availability Rules and Operating Hours, the closure workflow for Closures, and a facility-scoped appointment-type catalog for Appointment Types. Visitor appointment creation rejects inactive or unknown catalog codes.
- Appointment Types now has a supervisor-protected update path with optimistic versioning, idempotency, history, audit, and outbox records; the management panel can activate or deactivate catalog entries without direct database access.
- Visitor availability now reuses the same server-side visit-window validator as appointment creation and rescheduling, preventing the UI from advertising slots that the write path would reject.
- Successful payment settlement webhooks now require provider reference, amount, and currency before any credit ledger entry can be created; missing settlement fields fail closed and remain retryable.
- Availability date/time parsing now rejects impossible calendar dates and malformed local times instead of allowing JavaScript date normalization to move a request onto another day.
- Outbox processing now persists claim start time and stale-claim recovery uses claim age rather than event creation age, preventing long-queued events from being reclaimed while an active delivery is still running.
- Outbox workers claim rows before parsing payloads, so malformed events enter bounded retry/dead-letter handling instead of remaining permanently `PENDING`.
- Evidence retention now uses a recoverable `PENDING_DELETION` database claim before R2 deletion; storage failure restores the record for retry and a crash can be recovered by the next scheduled run.
- Pending-deletion evidence is excluded from break-glass retrieval, and the retention worker rechecks legal-hold state after claiming before deleting from R2.
- OIDC ID-token validation now rejects malformed issuer, subject, audience, or expiry claim shapes before signature claims are used for staff authorization.
- Payment creation and refund requests are audited, and the visitor now has an owner-scoped payment status/return page with bounded webhook-status polling; a real provider adapter, provider dispute workflow and staging reconciliation proof still need completion.
- The scheduled worker now expires only abandoned pre-checkout payment intents after a bounded window with optimistic concurrency, audit, outbox notification and no effect on provider-created checkouts.
- Notification records and outbox processing exist, but real email/SMS delivery adapters, templates, delivery receipts, retry operations and dead-letter replay need staging proof.
- Visitor session controls still need production delivery, recovery, suspicious-login handling and device-management validation beyond the development OTP path.
- Kiosk identity and device checks have strong boundaries, but real controlled-device enrollment, secure storage of kiosk credentials, rotation procedure and physical-device recovery are not proven.
- Kiosk presence now clears on page hide/session exit, and the terminal kiosk state has an explicit reset to the credential boundary before the next assignment.
- Repeat visitor Waiting Room heartbeats now refresh presence freshness without incrementing appointment or readiness versions; first check-in and actual state transitions remain optimistic-concurrency-protected.
- Waiting Room's time-window selector now filters the persisted queue by the next two hours, facility-local today, or all approved records instead of being visual-only; queue counts use the selected window.
- Control appointments and facility state now refresh from protected APIs every 15 seconds with no-store caching and explicit unavailable-state handling, so operational screens do not remain silently stale after mount.
- The Control top-bar notification action now reads facility-scoped persisted security events and distinguishes loading, empty, and unavailable states instead of claiming there are no notifications without an API read.
- Live-session staff observation and provider webhook behavior need a real deployment test. Recording remains intentionally disabled and must not be silently enabled.
- Live-session join validation now rejects participant tokens before the authorized start window, with a one-minute clock-skew grace, in addition to the existing expiry and recording-policy checks.
- Administration now exposes the protected deployment-readiness API, including database, schema, provider, storage, visitor-auth, staff-identity and notification checks without returning secret values.
- Audit export manifests can now be retrieved through an authorized, facility-scoped verification endpoint. Break-glass requests and supervisor decisions are now persisted with time-bound grants, step-up checks, optimistic concurrency, audit events, and outbox events; staging access-review and policy validation remain release gates.
- Data retention and deletion need scheduled-job evidence, exception handling, legal-hold behavior and restore/rollback procedures.
- The dramatic spin is a product interaction plan, not a completed business feature. The server must decide and persist the result before animation; the animation must never decide the outcome. The deterministic component also honors reduced-motion for both its completion timer and CSS transition.

## Canonical working workflow

Every transition must be persisted, facility-scoped, authorized, idempotent where the request can be retried, and represented in audit history. Refreshing any page must reconstruct the same state from the backend.

```text
Visitor signs in
  -> profile and contact verified
  -> relationship submitted
  -> staff identity/relationship review
  -> relationship approved
  -> visitor sees eligible prisoner and availability
  -> visitor purchases credit
  -> provider webhook is verified and credit ledger is settled
  -> visitor requests appointment
  -> policy and availability validation
  -> staff approves / rejects / requests information
  -> approval atomically reserves room/device and one credit
  -> device check passes within freshness window
  -> waiting room opens
  -> visitor presence + kiosk presence + staff readiness are recorded
  -> staff admits visitor only when every readiness fact passes
  -> visitor and kiosk join LiveKit room; staff observer may monitor
  -> session ends or expires idempotently
  -> credit is consumed or reservation is released according to policy
  -> visitor receives completion/refund result
  -> audit, notification and incident records are available
```

### Required state invariants

- A visitor cannot see or mutate another facility's prisoner, relationship, appointment, credit or payment.
- An appointment cannot be approved without an approved relationship, eligible prisoner, valid facility policy, non-conflicting resource and available credit.
- A credit cannot be reserved twice, consumed twice, refunded twice or made available by a non-authoritative UI action.
- Waiting Room admission requires recent visitor device readiness, valid kiosk credential, recent kiosk heartbeat, presence signals, policy approval, healthy resource and no operational restriction.
- A LiveKit token is scoped to one session, one participant role and a short expiry. Observers cannot publish. Recording is disabled.
- Provider webhooks are authenticated, replay-window checked, event-key idempotent and amount/currency/reference validated.
- All staff decisions and sensitive administrative actions have actor, facility, request and correlation identifiers.
- Failed provider, database, kiosk and notification operations remain visible and retryable; no UI substitutes invented success data.

## Completion plan

### Phase 0 — Baseline and environment contract

- Define local, staging and production variables and secret ownership.
- Add a startup/deploy validation command that checks required bindings, URLs, allowed origins, LiveKit, payment, mail/SMS, D1 and object storage configuration.
- Add explicit migration status and deployment smoke checks.
- Document the exact local commands, including frontend preview on port 5174 and Worker/API on port 8001 when using a split setup.
- Keep same-origin development as the default unless the split API is required; avoid CORS drift.

Exit evidence: clean migration from empty database, migration status output, environment validation output, build/typecheck/lint/test/E2E pass.

### Phase 1 — Identity and access

- Finish OIDC and SAML callback/claim mapping against a test IdP.
- Enforce MFA through the IdP and step-up for lockdown, refunds, exports, retention, legal holds and incident closure.
- Finish visitor production email/SMS delivery, OTP rate limits, expiry, recovery, suspicious-login events and session/device management.
- Review every protected route through centralized policy helpers and add negative facility/role tests.

Exit evidence: IdP staging login, MFA, revoked-session behavior, visitor recovery, authorization matrix and facility-isolation tests.

### Phase 2 — Visitor verification and prisoner discovery

- Finish protected evidence upload to object storage with signed access, scan result, metadata-only database records, retention and legal holds.
- Complete staff verification queue, evidence review, request-more-information, rejection and visitor notifications.
- Replace any remaining demo visitor state with persisted API state and refresh-safe loading.

Exit evidence: visitor submits relationship, staff reviews, visitor sees decision after refresh, unauthorized evidence access is rejected.

### Phase 3 — Real credits and payments

- Select one Indonesian payment provider and implement its adapter without coupling domain code to provider fields.
- Test checkout creation, return/cancel, delayed success, duplicate webhook, invalid signature, replayed webhook, wrong amount/currency, expiry, refund, dispute and reconciliation.
- Add staff finance views for payment state, ledger state, discrepancies and controlled refund.
- Confirm the tariff, cancellation policy and tax/receipt requirements before enabling production checkout.

Exit evidence: sandbox money journey creates exactly one purchase ledger entry and all failure/retry cases reconcile.

### Phase 4 — Appointment and resource truth

- Finish availability calculation from persisted policy, blackout, prisoner eligibility and resource reservations.
- Prove concurrent approval, resource collision prevention, cancellation, reschedule, no-show and credit release.
- Add complete decision history and SLA notifications.

Exit evidence: two simultaneous staff actions cannot double-approve, double-reserve or double-charge.

### Phase 5 — Waiting Room and kiosk

- Enroll a real kiosk/device, rotate/revoke credentials and prove recovery.
- Persist visitor presence, kiosk presence, device checks, network checks, staff notes and blockers.
- Validate every readiness state and transition, including late, technical issue, staff review, reassign, cancel and retry.
- Use short polling or durable realtime refresh with stale-data indicators.

Exit evidence: approved appointment flows into Waiting Room automatically and admission is impossible until all readiness checks pass.

### Phase 6 — Live Session

- Run visitor, kiosk and staff observer clients against staging LiveKit.
- Test join authorization, participant roles, reconnect, browser permissions, network loss, provider outage, expiry, staff termination and orphan-room cleanup.
- Finalize completion and credit outcome exactly once; record incident when required.
- Keep recording disabled and assert the policy at token, UI and provider configuration layers.

Exit evidence: full three-party journey passes repeatedly, including refresh/retry and forced failure scenarios.

### Phase 7 — Operations and management

- Connect People, Finance, Facility, Administration, Reports and Compliance to real APIs or hide them from pilot roles.
- Finish notification adapters, delivery attempts, templates, dead-letter replay and alerting.
- Finish incidents, audit export, access reviews, break-glass workflow, staff provisioning and policy history.

Exit evidence: staff can operate a day without demo data, and every operational exception has an owner, state, history and recovery action.

### Phase 8 — Reliability, privacy and launch assurance

- Configure monitoring, dashboards, structured logs, alerts, WAF, rate limits and secret rotation.
- Run D1 backup/restore, object-storage recovery, provider outage and notification outage drills.
- Run retention/deletion and legal-hold drills.
- Add browser-level journey tests and a seeded staging test pack.
- Complete security review, privacy/correctional review, access review and pilot go/no-go.

Exit evidence: signed release checklist, rollback plan, incident runbooks, restore evidence and clean staging journey.

## Exact next implementation prompt

Use this prompt for the next coding sprint:

> Implement SecureVisit Phase 1 and Phase 2 as a production-structured vertical slice. First audit every visitor and staff authentication route and produce a route matrix with identity source, facility scope, permission, session behavior, rate limit, audit event and negative tests. Then finish production visitor email OTP delivery behind a provider interface, with development delivery remaining explicit and disabled outside development. Add OTP expiry, one-time consumption, request throttling, delivery-attempt records, suspicious-login security events, recovery/session revocation behavior and refresh-safe visitor authorization. Complete the persisted visitor relationship and evidence workflow: protected object-storage abstraction, upload metadata, content-length/type validation, scan status, signed staff-only evidence access, staff approve/reject/more-information decisions, retention metadata and visitor notifications. Replace any remaining query-string/demo state on the visitor verification and appointment entry screens with authoritative APIs. Add integration tests for duplicate OTP requests, expired/replayed codes, facility isolation, unauthorized evidence access, duplicate relationship submission, review idempotency, notification retry and refresh persistence. Add a browser test for: visitor OTP sign-in -> relationship submission -> staff review fixture -> visitor sees approved result after refresh. Run typecheck, lint, full server tests, browser tests, inspect the diff, commit with a focused message and push to origin/main. Do not claim the phase is production-ready until provider configuration, protected storage and staging tests are explicitly recorded as passed.

## Dramatic spin implementation contract

The spin must be a deterministic, auditable presentation of a server decision, not a random client-side business action.

1. The server validates eligibility, computes the result, persists the result and a correlation/audit record, then returns `spinId`, `result`, `finalAngle`, `durationMs` and `animationVersion`.
2. The client disables repeat activation immediately and animates only the returned result. A retry with the same idempotency key returns the same result.
3. Use 4.2–5.5 seconds total duration, a very fast first movement and a pronounced slow final 15–20%. A cubic-bezier close to `(0.05, 0.78, 0.12, 1)` is the default starting curve; tune visually without changing the persisted result.
4. Derive the final transform from a deterministic formula such as `fullTurns * 360 + targetIndex * segmentAngle + landingOffset`, normalized so the pointer lands on the server-selected segment.
5. Show a short anticipation state, fast acceleration, visible deceleration and a settled result state. Do not use a client random number, timer race or CSS-only result to decide eligibility or value.
6. Support reduced motion with an immediate or short transition to the same final angle. Audio and haptics are optional, opt-in, and must not block completion.
7. Persist animation completion separately from business completion if recovery matters. On refresh, read the persisted result and show a settled state.
8. Test duplicate clicks, refresh during animation, reduced motion, slow device, tab backgrounding, mismatched result/angle, idempotent retry and unauthorized access.

## Launch checklist

The pilot is ready only when all of these are true:

- Real IdP, MFA, visitor delivery, payment provider, LiveKit and protected storage are configured in staging.
- The full three-party journey passes after refresh, duplicate requests, delayed webhooks, provider failure and unauthorized attempts.
- No pilot page depends on demo query state or invented success records.
- Every money, access, appointment, session, incident and retention mutation has audit evidence.
- Backups restore successfully and operators can execute outage/runbook procedures.
- Recording remains disabled unless a separately approved policy and storage workflow exists.
- Security, privacy, correctional-policy and institutional operations owners sign the go/no-go decision.
