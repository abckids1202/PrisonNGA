# SecureVisit — Xendit staging acceptance

This checklist is for the staging payment gate. It does not authorize live
payments and it does not replace the facility tariff or refund-policy approval.
Use Xendit Test Mode, synthetic visitors, and the staging Worker only.

## Provider contract used by the adapter

SecureVisit uses Xendit Payment Sessions in hosted `PAYMENT_LINK` mode:

- `POST /sessions` creates one checkout session using the SecureVisit payment
  intent as `reference_id`.
- The adapter persists `payment_session_id` and returns Xendit's
  `payment_link_url` to the visitor.
- `GET /sessions/{payment_session_id}` resolves the related
  `payment_request_id` before a refund request.
- `POST /refunds` sends the payment request ID, the approved amount/currency,
  and a stable refund idempotency key.

The browser return page is informational only. Credits are granted only after
the signed Xendit webhook reaches `/api/webhooks/xendit` and the canonical
payment processor commits the ledger transaction.

## Staging configuration

Configure these values through the Cloudflare/Vercel secret stores. Never add
them to `.env.example`, CI output, screenshots, or evidence files:

```text
PAYMENT_PROVIDER=xendit
XENDIT_API_BASE_URL=https://api.xendit.co
XENDIT_SECRET_KEY=<staging test-mode secret>
XENDIT_WEBHOOK_TOKEN=<staging verification token>
PAYMENT_WEBHOOK_SECRET=<SecureVisit webhook signing secret>
PUBLIC_APP_URL=https://<staging visitor origin>
```

Configure the Xendit webhook topics for:

- Payment Session completed
- Payment Session expired
- Refund request succeeded
- Refund request failed
- Dispute lifecycle events required by the institution

Point the callbacks to:

```text
https://<staging-origin>/api/webhooks/xendit
```

The callback must include Xendit’s callback token and unique webhook delivery
ID. SecureVisit rejects missing, malformed, replayed, or conflicting delivery
identifiers.

## Acceptance sequence

Record the SecureVisit payment intent ID, provider session ID, provider event
ID, request/correlation IDs, ledger entry IDs, and audit/outbox IDs. Do not
record payment secrets or full customer payment details.

1. Create a payment intent using the facility’s approved staging tariff.
2. Confirm the persisted intent is pending and the visitor has no new credit.
3. Create checkout and verify the hosted URL is HTTPS and belongs to Xendit.
4. Complete the Xendit Test Mode checkout.
5. Deliver the completion webhook and verify exactly one purchase ledger entry.
6. Deliver the same webhook again and verify no second credit or balance write.
7. Deliver a valid event with a reused webhook ID but changed payload and verify
   that it is rejected as a replay conflict.
8. Delay the completion webhook and confirm the browser cannot grant credit.
9. Expire a checkout session and verify the intent becomes expired without a
   credit entry.
10. Request a refund through the staff finance workflow; verify step-up,
    approval, and provider refund request persistence.
11. Deliver the refund-success webhook twice and verify one refund ledger
    reversal.
12. Deliver a refund-failed webhook and verify the payment remains visible for
    finance recovery without silently changing the ledger.
13. Deliver a dispute event and verify the payment is marked disputed and a
    finance/security follow-up is created.
14. Exercise provider timeout, HTTP 5xx, invalid JSON, invalid signature, and
    rate-limit behavior.
15. Reconcile the SecureVisit payment ledger against Xendit’s Test Mode
    records and attach the signed report to the pilot evidence register.

## Go/no-go evidence

The payment gate remains **NOT PROVEN** until the staging evidence contains:

- approved tariff and cancellation/refund policy references;
- successful hosted checkout;
- signed completion, expiry, refund, and dispute callbacks;
- duplicate, delayed, conflicting, and replayed webhook outcomes;
- provider-outage and retry/dead-letter evidence;
- ledger, refund, audit, notification, and reconciliation records; and
- an owner-approved report showing that no browser return path created credit.

Local Xendit adapter tests prove request shaping and normalization only. They
do not prove Xendit account configuration, payment-channel availability,
webhook delivery, refund eligibility, or institutional approval.
