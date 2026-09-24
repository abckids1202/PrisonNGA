# SecureVisit security foundation

This prototype uses the platform's workspace authentication headers as its identity provider. SecureVisit does not invent a second public OAuth or password system inside the starter. Server routes read the authenticated identity on the server, then require a provisioned user, a facility-scoped staff profile, and a granular permission before returning protected data.

Implemented foundations:

- D1 schema for users, staff profiles, facilities, roles, permissions, sessions, security events, audit events, outbox events, prisoners, visitor profiles, relationships, verification cases, appointments, resources, and Visit Credit ledger entries.
- Facility-scoped authorization through `requirePermission()`.
- Generic 401/403 responses that do not reveal whether an account exists.
- Request IDs on protected responses.
- Global security headers: CSP, frame denial, MIME sniffing protection, referrer policy, permissions policy, and no-store API responses.
- Append-only audit and outbox records for facility-state changes.
- Version checks for stale facility-state changes.
- Fictional facility, prisoner, role, and permission seed data in `db/seed.sql`.
- Live Session records are separate from appointment state, with short-lived role-scoped LiveKit tokens, provider webhook verification, session events, audit entries, and server-side end-time enforcement.
- Kiosk LiveKit token issuance requires an active per-device secret in addition to its registered resource ID. Only a SHA-256 digest is stored; credentials are revocable and issuance is audited.

## Runtime setup

1. Apply the generated migration in `drizzle/` to the D1 database bound as `DB` (`npm run db:migrate:local` for local D1 or `npm run db:migrate:remote` for a named remote Wrangler environment).
2. Apply `db/seed.sql` once to create the fictional facility, roles, and permission catalog.
3. Provision workspace identities into `users`, `staff_profiles`, and `user_roles` through an institution-controlled admin workflow. There is intentionally no self-service role escalation endpoint.
4. Set `SECUREVISIT_HASH_SALT` in the runtime secret store before recording production security-event hashes. The local fallback is only for development.
5. Configure `VIDEO_PROVIDER=livekit`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in the server runtime. The secret must never be exposed through a public frontend environment variable.
6. Configure the visitor authentication delivery adapter. `VISITOR_AUTH_DELIVERY=console` is development-only. Production uses the provider-neutral HTTPS adapter with `VISITOR_AUTH_WEBHOOK_URL` and `VISITOR_AUTH_WEBHOOK_SECRET`; the downstream email/SMS service must verify the HMAC over `<x-securevisit-timestamp>.<raw-body>`, reject timestamps older than five minutes, route the declared `EMAIL` or `SMS` channel, and must never return the OTP.
7. Configure the `EVIDENCE_BUCKET` R2 binding and set `EVIDENCE_RETENTION_DAYS`; the visitor evidence API intentionally refuses uploads without the binding.
8. Configure the provider-neutral payment adapter with `PAYMENT_PROVIDER=webhook`, an HTTPS `PAYMENT_CHECKOUT_URL`, `PAYMENT_PROVIDER_SECRET`, the separate inbound `PAYMENT_WEBHOOK_SECRET`, and an institution-approved `VISIT_CREDIT_PRICE_MINOR`. The checkout service must return `{ providerReference, checkoutUrl }`, verify the HMAC over `<x-securevisit-timestamp>.<raw-body>`, reject timestamps older than five minutes, honor `Idempotency-Key` as the payment intent ID, and only return HTTPS checkout URLs.
9. Configure `NOTIFICATION_DELIVERY=webhook`, `NOTIFICATION_WEBHOOK_URL`, and `NOTIFICATION_WEBHOOK_SECRET` in production. The notification service must verify the timestamp-bound HMAC, reject timestamps older than five minutes, and honor the supplied idempotency key; in-app notifications remain persisted locally.
10. Check `/api/health/readiness` after deployment. It reports only whether the database and required schema are ready; it does not expose missing secret names.
11. Configure `STAFF_STEP_UP_SECRET` through the institution’s secret manager. The trusted institutional MFA adapter must issue a v2 `x-securevisit-step-up` assertion as `v2.<unix_ms>.<unique_nonce>.<hex_hmac>`. The HMAC-SHA256 input is the UTF-8 JSON array `[`"securevisit-step-up-v2"`, purpose, userId, targetId, payloadSha256, timestamp, nonce`]`; `payloadSha256` is the lowercase hex SHA-256 of recursively key-sorted compact JSON for the exact normalized action payload. The assertion is valid for at most five minutes and its nonce is consumed once in D1. The payload includes action, target/resource, reason, and expected version. Never create assertions in browser code. The shared HMAC is only a signed adapter assertion; it does not itself prove that an IdP MFA ceremony occurred. Configure the adapter so it only signs after its verified step-up challenge and never expose the secret to the browser.
12. Apply migration `0019_kiosk_credentials.sql`. In Control → Operations → Resources, a facility supervisor can issue, rotate, or revoke a device credential with an audited reason. The UI reads active credential state from the facility-scoped resource API and keeps a newly issued token in component memory only so it can be copied once; provision it directly into the kiosk's protected local secret store and do not log or persist it. Both API actions require fresh step-up assertions with purpose `kiosk_credential_issue` or `kiosk_credential_revoke`; the browser intentionally cannot create those assertions. The kiosk must send the token as `X-SecureVisit-Kiosk-Token` alongside `X-SecureVisit-Kiosk-ID` when requesting a LiveKit token.
13. Apply migrations `0020_saml_request_cache.sql` and `0021_saml_request_state_binding.sql` before enabling SAML staff login. SAML AuthnRequest IDs are held in D1 for ten minutes, bound to the hash of that login's RelayState, and require a matching `InResponseTo`; do not use a process-local cache or disable either check. OIDC staff account matching also requires the signed `email_verified: true` claim.

## Important limitations

This is not a production authorization deployment yet. Institutional OIDC/SAML configuration, a deployed and tested MFA assertion issuer, managed secrets, WAF/rate limiting, payment provider verification, visitor delivery, kiosk fleet provisioning and secret storage, and independent security review are still required. Identity evidence metadata is facility-scoped and raw uploads fail closed unless the `EVIDENCE_BUCKET` R2 binding exists; retention policies, legal holds, and scheduled deletion are enforced server-side. Video is real when LiveKit is configured; recordings and real payment processing remain disabled until their operational controls are implemented.
