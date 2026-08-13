# SecureVisit security foundation

This prototype uses the platform's workspace authentication headers as its identity provider. SecureVisit does not invent a second public OAuth or password system inside the starter. Server routes read the authenticated identity on the server, then require a provisioned user, a facility-scoped staff profile, and a granular permission before returning protected data.

Implemented foundations:

- D1 schema for users, staff profiles, facilities, roles, permissions, sessions, security events, audit events, outbox events, appointments, resources, and Visit Credit ledger entries.
- Facility-scoped authorization through `requirePermission()`.
- Generic 401/403 responses that do not reveal whether an account exists.
- Request IDs on protected responses.
- Global security headers: CSP, frame denial, MIME sniffing protection, referrer policy, permissions policy, and no-store API responses.
- Append-only audit and outbox records for facility-state changes.
- Version checks for stale facility-state changes.
- Mock role and permission seed data in `db/seed.sql`.

## Runtime setup

1. Apply the generated migration in `drizzle/` to the D1 database bound as `DB`.
2. Apply `db/seed.sql` once to create the fictional facility, roles, and permission catalog.
3. Provision workspace identities into `users`, `staff_profiles`, and `user_roles` through an institution-controlled admin workflow. There is intentionally no self-service role escalation endpoint.
4. Set `SECUREVISIT_HASH_SALT` in the runtime secret store before recording production security-event hashes. The local fallback is only for development.

## Important limitations

This is not a production authorization deployment yet. PostgreSQL RLS, institutional SSO/passkeys, formal MFA step-up, managed secrets, WAF/rate limiting, background outbox workers, and independent security review still belong in the production hardening phase. Video, recordings, real payments, identity-document uploads, and prisoner data remain out of scope for this fictional prototype.
