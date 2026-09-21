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

## Runtime setup

1. Apply the generated migration in `drizzle/` to the D1 database bound as `DB` (`npm run db:migrate:local` for local D1 or `npm run db:migrate:remote` for a named remote Wrangler environment).
2. Apply `db/seed.sql` once to create the fictional facility, roles, and permission catalog.
3. Provision workspace identities into `users`, `staff_profiles`, and `user_roles` through an institution-controlled admin workflow. There is intentionally no self-service role escalation endpoint.
4. Set `SECUREVISIT_HASH_SALT` in the runtime secret store before recording production security-event hashes. The local fallback is only for development.
5. Configure `VIDEO_PROVIDER=livekit`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in the server runtime. The secret must never be exposed through a public frontend environment variable.
6. Configure the visitor authentication delivery adapter. `VISITOR_AUTH_DELIVERY=console` is development-only. Production uses the provider-neutral HTTPS adapter with `VISITOR_AUTH_WEBHOOK_URL` and `VISITOR_AUTH_WEBHOOK_SECRET`; the downstream email/SMS service must verify `x-securevisit-signature` and must never return the OTP.
7. Configure the `EVIDENCE_BUCKET` R2 binding and set `EVIDENCE_RETENTION_DAYS`; the visitor evidence API intentionally refuses uploads without the binding.
8. Check `/api/health/readiness` after deployment. It reports only whether the database and required schema are ready; it does not expose missing secret names.
9. Configure `STAFF_STEP_UP_SECRET` through the institution’s secret manager and have the IdP/step-up adapter issue `x-securevisit-step-up` assertions in the format `timestamp.hex_hmac(purpose:userId:timestamp)`. Lockdown, emergency closure, and incident closure reject ordinary sessions without a fresh assertion.

## Important limitations

This is not a production authorization deployment yet. Institutional OIDC/SAML configuration, formal MFA step-up, managed secrets, WAF/rate limiting, payment provider verification, visitor delivery, and independent security review are still required. Identity evidence metadata is facility-scoped and raw uploads fail closed unless the `EVIDENCE_BUCKET` R2 binding exists; retention policies, legal holds, and scheduled deletion are enforced server-side. Video is real when LiveKit is configured; recordings and real payment processing remain disabled until their operational controls are implemented.
