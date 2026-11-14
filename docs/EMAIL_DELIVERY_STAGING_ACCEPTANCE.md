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
4. Configure the provider’s delivery-event webhook to a staging relay. The relay must:
   - verify the provider’s native signature and timestamp;
   - reject stale or replayed provider events;
   - map the provider event to `provider`, `providerReference`, `eventId`, and an allowed status;
   - sign the raw SecureVisit payload with `NOTIFICATION_STATUS_WEBHOOK_SECRET`;
   - send the signed request to `/api/webhooks/notifications/status`;
   - retry only with the same event ID and payload.
5. Keep the relay outside the browser and never include the Resend API key in it or in Vercel variables exposed to the client.

The SecureVisit status callback accepts `SENT`, `DELIVERED`, `FAILED`, `BOUNCED`, `REJECTED`, `UNDELIVERED`, `INVALID_NUMBER`, `QUEUED`, and `PROCESSING`. `SENT`, `QUEUED`, and `PROCESSING` remain in-progress; only `DELIVERED` is success, and terminal failure statuses expire the linked OTP challenge.

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
