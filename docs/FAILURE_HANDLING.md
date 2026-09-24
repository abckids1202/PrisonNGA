# SecureVisit failure-handling contract

This matrix is part of the pilot release contract. The browser must display the persisted state returned by the server; it must never infer approval, readiness, completion, or credit settlement from a failed request.

| Failure | User-visible result | Retry / idempotency | Credit and appointment | Staff action and records |
| --- | --- | --- | --- | --- |
| Payment failed | Checkout shows failed; balance is unchanged | Visitor may retry with a new payment intent; webhook event key is replay-safe | No credit is posted or reserved | Payment status, provider event, audit, and notification are recorded |
| Payment delayed | Checkout shows processing and explains that confirmation is pending | Provider repeats the signed event; event key and ledger key deduplicate | No credit is available until settlement | Worker retries with backoff; finance sees the pending event |
| Duplicate webhook | Existing payment result is shown | Same provider/event key returns idempotent success; payload mismatch is rejected | Ledger receives one purchase at most | Replay and mismatch are auditable |
| Appointment collision | Request is rejected with another time required | Same idempotency key replays the original response | No resource or credit reservation is created | Policy/resource conflict is audited when it reaches staff review |
| Credit reservation failed | Staff approval remains rejected or requires attention | Approval command may be retried with the same idempotency key after balance correction | Credit remains available; appointment is not approved | Approval failure is audited and surfaced in the queue |
| Visitor late | Visitor sees a late state and next instruction | Presence/check-in calls remain retry-safe | Credit stays reserved until staff/no-show decision | Staff may mark late, admit, reschedule, or cancel; each transition is audited |
| Prisoner unavailable | Visitor sees facility delay or cancellation notice | Staff can retry presence or perform a controlled reschedule | Credit is released on cancellation or according to the approved policy | Staff records reason; notification and audit are emitted |
| Kiosk disconnected | Visitor remains waiting; staff sees stale kiosk health | Heartbeat and reconnect are retry-safe; stale sessions are reconciled | Credit remains reserved while the visit is recoverable | Staff can retry, reassign, escalate, or terminate; incident may be opened |
| Camera or microphone failed | Device Check identifies the failed check and blocks admission | Visitor may rerun the check; attempts are persisted and rate-limited | Credit remains reserved; no session starts | Staff sees the blocker and may contact, reassign, or cancel |
| Network degraded | Device/session shows degraded connectivity and recovery guidance | Checks and reconnect events may retry safely | No settlement occurs until the server records the outcome | Staff can wait, terminate, or classify technical failure |
| LiveKit unavailable | Live visit cannot start; provider unavailable is explicit | Token/session requests are rate-limited and safe to retry | Reserved credit is released if no visit starts; otherwise the final session policy applies | Provider failure is logged, audited, and eligible for incident escalation |
| Staff session expired | Staff action is rejected and the user is returned to authentication | Re-authentication is required; mutation idempotency key remains reusable | No partial transition is accepted | Security event is recorded; step-up must be performed again |
| Notification failed | Core workflow result remains visible in the relevant workspace | Outbox retries with backoff; delivery key deduplicates | Domain state is not rolled back solely because notification failed | Delivery attempt, error, retry, and dead-letter state are operationally visible |
| Refund delayed | Visitor sees refund pending, not falsely completed | Provider retries are idempotent and reconciled | Credit is not silently restored twice | Finance reviews provider event and reconciliation state |
| Provider outage | Affected capability is unavailable with a clear retry path | No synthetic success is created; queued provider work is retryable | Domain balances remain unchanged until authoritative confirmation | Readiness/operations alert and incident procedure apply |
| Database unavailable | Generic service-unavailable response; no sensitive details leak | Safe client retry uses the same idempotency key | No success is shown without a committed transaction | Infrastructure alerting and recovery runbook apply |

## Invariants

- A failed or ambiguous request cannot create a successful payment, approval, readiness, live session, completion, or credit settlement.
- Every retryable mutation has a stable idempotency boundary or a persisted provider event key.
- Credit is reserved only inside the approval transaction and is released or consumed only inside the terminal appointment/session transition.
- Audit and outbox writes are part of the same transaction as the sensitive domain transition.
- Provider, kiosk, and database failures remain visible to staff instead of being replaced with demo data.
- Recording remains `OFF` and `NOT_RECORDED` for the pilot.
