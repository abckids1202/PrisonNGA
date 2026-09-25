# SecureVisit workflow state and evidence matrix

This is the authoritative planning contract for the single-facility pilot. A state is not considered complete because a screen displays it; the transition must be persisted, facility-scoped, authorized, retry-safe, audited, and recoverable after refresh.

## 1. End-to-end state sequence

```text
Visitor account
  → relationship submitted
  → verification under review
  → verification approved
  → credit purchased
  → appointment submitted
  → appointment approved
  → device check passed
  → waiting room entered
  → visitor + kiosk ready
  → staff admitted
  → live session
  → completed / failed / cancelled
  → credit consumed or released/refunded
  → receipt, notification, audit
```

The browser, kiosk, and staff UI may request transitions, but the server is authoritative for approval, readiness, admission, completion, credit settlement, and refund disposition.

## 2. Transition contract

| Transition | Preconditions | Atomic writes | Retry behavior | Required evidence |
|---|---|---|---|---|
| OTP verified | Unexpired, unconsumed challenge; attempts available | Consume challenge, create/update visitor, create session, login audit | Same challenge cannot be consumed twice | Auth event, session, request ID |
| Relationship submitted | Visitor owns profile; prisoner is facility-scoped | Relationship, verification case, audit, notification outbox | Idempotency key returns original result | Case history and audit event |
| Verification approved | Approved relationship, required evidence available | Case + relationship status/version, audit, visitor notification | Same decision replays safely; stale version fails | Decision reason, actor, correlation ID |
| Credit purchased | Provider-confirmed payment event | Provider event, payment status, one purchase ledger entry, notification | Duplicate webhook creates no second ledger entry | Signed event and reconciliation record |
| Appointment approved | Eligibility, available slot, resource, unreserved credit | Appointment status, resource reservation, credit reservation, decision history, audit/outbox | Concurrent approval loses with conflict; retry uses idempotency | Policy snapshot, reservation IDs |
| Device check passed | Appointment belongs to visitor; camera/mic/network checks pass | Device-check attempt and appointment readiness facts | Repeat check creates bounded attempt history; does not bypass policy | Check result, timestamp, device metadata |
| Waiting-room ready | Fresh visitor/kiosk presence, valid assignment, all checks pass | Readiness state and transition history | Stale presence fails closed | Readiness facts and blocker history |
| Staff admission | Facility open, appointment ready, staff permission, fresh facts | Admission, session activation, audit/outbox | Duplicate admission returns current session | Actor, session ID, correlation ID |
| Live session ended | Authorized end/timeout/provider event | Session finalization, appointment outcome, resources, credit settlement, audit/outbox | End is idempotent across staff, webhook, scheduler | Final outcome and provider event |
| Refund requested | Policy permits refund; payment is refundable | Refund request and audit/outbox | Same idempotency key returns original request | Reason, actor, payment/provider IDs |

## 3. Failure disposition matrix

| Failure | Visitor/kiosk sees | Retry | Credit/resource disposition | Staff action | Evidence |
|---|---|---|---|---|---|
| Payment failed | Checkout failed; balance unchanged | New checkout allowed | No credit; no appointment approval | None unless repeated | Payment status, audit, delivery attempt |
| Payment delayed | Payment pending | Provider webhook/reconciliation retry | No usable credit until confirmed | Finance monitors | Provider event and reconciliation issue |
| Duplicate webhook | Existing confirmed result | Acknowledge safely | Exactly one ledger purchase | None | Idempotency/provider-event record |
| Appointment collision | Requested slot unavailable | Choose another slot | No reservation retained | Review only if contention persists | Conflict audit |
| Credit reservation failed | Appointment remains pending/blocked | Retry after balance correction | Credit remains available | Resolve ledger issue | Transaction error and audit |
| Visitor late | Late/check-in state | Rejoin while policy allows | Reserved until staff no-show/cancel decision | Mark late, extend, reschedule, or cancel | Presence and transition history |
| Prisoner unavailable | Delayed or cancelled message | Staff may reschedule | Release/refund according to policy | Record operational reason | Incident/notification/audit |
| Kiosk disconnected | Facility is reconnecting | Heartbeat/reconnect | No admission; no settlement | Reassign or escalate | Kiosk heartbeat and incident |
| Camera/microphone failed | Specific device guidance | Re-run check or change device | No session start; reservation remains policy-controlled | Contact or reschedule | Device-check attempt |
| Network degraded | Connection warning | Retry measurement/reconnect | Not ready until threshold passes | Wait, reassign, or cancel | Network result and blocker |
| LiveKit unavailable | Visit cannot start | Safe session/token retry | Release or refund if no session started | Escalate provider incident | Provider error, audit, outbox |
| Staff session expired | Action rejected; no success shown | Re-authenticate and retry | No state mutation | None | Security event/request ID |
| Notification failed | In-app state remains source of truth | Worker backoff/replay | Domain state unchanged | Monitor dead letter | Delivery attempts/outbox |
| Refund delayed | Refund pending | Provider reconciliation/retry | Credit remains policy-controlled | Finance follows up | Refund request/provider event |
| Provider outage | Explicit service unavailable | Backoff/retry after recovery | No fabricated success | Incident and status communication | Operational log/audit |
| Database unavailable | Generic service-unavailable response | Same idempotency key after recovery | No uncommitted success | Infrastructure recovery | Request/correlation telemetry |

## 4. Readiness requirements

An appointment may enter `READY_TO_START` only when all of these server-side facts are fresh and passing:

- Visitor identity/session is valid.
- Relationship and appointment are approved.
- Visitor presence is current.
- Kiosk identity is valid and facility-bound.
- Kiosk heartbeat is current.
- Visitor device check is current and passing.
- Kiosk device check is current and passing.
- Camera, microphone, and network checks pass.
- Room/device assignment is active and healthy.
- Facility is not restricted or locked down.
- No unresolved blocker prevents admission.

## 5. Live-session completion rules

The session finalizer must be safe when triggered by staff, provider webhook, scheduler timeout, or a repeated request. It must:

1. Acquire the session transition guard.
2. Persist the final session and appointment outcome.
3. Release the room/device reservation.
4. Consume, release, or refund credit according to the recorded outcome.
5. Write audit and notification outbox records in the same transaction.
6. Close or reconcile the provider room.
7. Leave a visible incident when provider cleanup fails.

Recording remains disabled until a separate approved policy covers consent, encryption, retention, legal hold, access approval, export, and deletion.

## 6. Staging evidence required before pilot approval

- Fresh D1 migration and seed.
- Real email/SMS provider sandbox.
- Real OIDC/SAML provider with MFA.
- Real payment sandbox and signed webhook retries.
- Protected object storage and malware-scan behavior.
- Enrolled kiosk with credential rotation and recovery.
- Three-party LiveKit session.
- Refresh after every major transition.
- Duplicate request and delayed webhook tests.
- Forced provider, device, network, notification, and database failure rehearsals.
- Backup/restore evidence.
- Audit export and access-review evidence.
- Security, privacy, and institutional approval.

## 7. Dramatic spin contract

If a future workflow uses the spin, the server must persist the result before animation and return a deterministic `spinId`, seed, selected segment, final angle, duration, and correlation ID. The client must never calculate a business result.

Recommended motion:

```text
0–15%   extremely fast acceleration
15–55%  high-speed rotation
55–80%  controlled deceleration
80–100% slow suspenseful settling
```

Use a 4.2–5.5 second duration, a custom easing curve equivalent to `cubic-bezier(0.05, 0.78, 0.12, 1)`, disabled duplicate actions, reduced-motion support, optional audio, and separately persisted animation completion.
