# SecureVisit email delivery — staging acceptance

This checklist proves the visitor email OTP path with a real staging provider. It is an external acceptance gate, not something local tests can satisfy. Use synthetic visitors and a staging domain only.

## Recommended launch configuration

The initial pilot is email-only:

```text
VISITOR_AUTH_CHANNELS=EMAIL
SECUREVISIT_VISITOR_EMAIL_ONLY_APPROVAL=approved
VISITOR_EMAIL_DELIVERY=resend
VISITOR_EMAIL_FROM=SecureVisit <no-reply@verified-staging-domain.example>
RESEND_API_KEY=<staging secret>
NOTIFICATION_STATUS_WEBHOOK_SECRET=<separate staging secret>
```

Do not enable `VISITOR_SMS_DELIVERY=twilio` until the institution has approved SMS as an authentication channel and the SMS acceptance evidence is complete. The visitor UI must not advertise an unconfigured channel.

## Provider and domain setup

1. Create a dedicated Resend project/API key for staging. Do not reuse production credentials.
2. Verify a sending domain owned by the institution. Configure the DNS records Resend provides and wait for domain verification.
3. Use a sender address on the verified domain. Do not use `example.com`, a personal mailbox, or a display-only address that cannot receive provider complaints.
4. Configure the provider’s delivery-event webhook directly to `/api/webhooks/resend`. SecureVisit verifies the native Svix signature and timestamp, rejects stale or replayed requests, maps the provider event to the canonical delivery-status contract, and forwards it internally to the replay-safe status processor.
5. Store the Resend webhook signing secret as `RESEND_WEBHOOK_SECRET` in the server-side secret store. Keep the Resend API key and webhook secret out of Vercel variables exposed to the client.

The native Resend callback accepts `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`, `email.suppressed`, and `email.complained`. These are normalized to SecureVisit’s `SENT`, `DELIVERED`, `PROCESSING`, `FAILED`, `BOUNCED`, or `REJECTED` states. Only `DELIVERED` is success, and terminal failure statuses expire the linked OTP challenge. The canonical status callback also accepts `UNDELIVERED` and `INVALID_NUMBER` for other providers.

## Acceptance evidence

Record the release ID, synthetic destination, request ID, challenge ID, provider message ID, callback event ID, and resulting database status. Never record the OTP code or secret values.

### Happy path

1. Request an email OTP from the staging visitor sign-in page.
2. Confirm the API response contains a challenge ID and masked destination, but no code.
3. Confirm the delivery attempt is persisted with provider `resend`, provider reference, and non-terminal `SENT` state.
4. Receive the email at a controlled staging mailbox and verify the sender domain, subject, expiry text, and absence of sensitive data beyond the OTP.
5. Submit the OTP once and confirm one visitor session is created.
6. Refresh and confirm the session remains valid until its configured expiry.

### Delivery and failure paths

Run each with a fresh synthetic challenge:

| Scenario | Expected result |
| --- | --- |
| `DELIVERED` callback | Attempt becomes `DELIVERED`; challenge remains usable until consumed/expired. |
| Duplicate identical callback | 200 idempotent response; no duplicate audit/outbox effect. |
| Same event ID with different payload | 409 replay conflict; original event remains authoritative. |
| Invalid callback signature | 401; no database mutation. |
| Stale callback timestamp | 401; no database mutation. |
| `BOUNCED`/`REJECTED`/`UNDELIVERED` | Attempt becomes `FAILED`; linked challenge expires immediately. |
| Provider timeout or 5xx | API returns a safe failure; no live OTP remains; retry creates a fresh challenge after the cooldown. |
| Callback before API finalization | Callback state is preserved and the later finalization does not overwrite terminal state. |
| Provider resend/retry with same idempotency key | At most one provider message is accepted and one SecureVisit attempt is retained. |
| OTP reuse | Rejected after first successful consumption. |
| Rate limit | Destination and IP limits are enforced without revealing account existence. |

### Recovery and operations

1. Stop delivery in the provider test project and confirm API failures are visible in logs/alerts without OTP or recipient leakage.
2. Restore provider access and request a fresh OTP; confirm recovery does not resurrect the failed challenge.
3. Confirm notification dead-letter/retry metrics and the operator replay path for non-auth notifications. OTP challenges themselves must be newly issued, not replayed from a dead letter.
4. Revoke the staging provider key, verify delivery fails closed, then rotate it and repeat the happy path.
5. Confirm the callback relay rejects events from an untrusted provider account or wrong environment.

## Go/no-go evidence

Email delivery is accepted for staging only when all of the following are attached to the pilot evidence register:

- verified sending domain and sender ownership;
- successful delivered OTP and one-time consumption;
- provider reference mapped to the persisted challenge attempt;
- signed callback, duplicate callback, replay-conflict, and stale-signature results;
- bounce/invalid-recipient challenge expiration;
- provider timeout and key-rotation recovery evidence;
- redacted logs proving request, challenge, provider, and correlation IDs without OTPs or secrets;
- named owner for provider billing, domain/DNS, webhook relay, and incident response.

This evidence does not approve a production sender, real visitor data, SMS, or institutional policy. Those require separate approval and production credentials.
