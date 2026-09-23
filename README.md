# SecureVisit

SecureVisit is a staff-first prototype for controlled correctional visitation operations. It brings the approval queue, facility schedule, room readiness, live-session control, credit activity, visitor portal preview, and audit trail into one calm operations workspace.

This build is still an MVP, but persisted D1 workflows now cover visitor connection requests, facility-scoped verification decisions, appointment requests/decisions, credit balances, and payment-intent records. Visitors can authenticate with an email or E.164 phone OTP; the delivery adapter is still provider-neutral and must be connected to a real email/SMS service before pilot use. Visitors can attach identity/relationship evidence when the protected R2 bucket is configured; reviewers can open available evidence through a facility-authorized route that writes an audit event. Verification approval is blocked until required evidence is available. The Visitor Credits screen can create a configured provider checkout and display persisted balances, ledger activity, and payment status; no real payment provider is enabled by default, so it does not process real payments until the adapter and webhook are configured and tested. The first pilot does not yet integrate with an external prisoner system. When configured, video media uses LiveKit WebRTC and recordings remain disabled by default.

## Run locally

```bash
npm install
npm run dev
```

To choose a port, pass it through to Vinext, for example `npm run dev -- --port 5174`, then open `http://localhost:5174`. This is a full-stack development server: the page and its `/api/*` routes share that origin. There is no separate backend-only server on port 8001 in this project.

The production checks are:

```bash
npm run build
npm run lint
npm test
```

### Local D1 database

Apply the checked-in SQL migrations before exercising persisted workflows:

```bash
npm run db:migrations:list:local
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Both the app's local Worker binding and the migration command use the same local D1 binding name, placeholder ID, and `.wrangler/state` persistence directory. Local migration commands do not require Cloudflare credentials. The SQL files in `drizzle/` are the migration source of truth and are applied by Wrangler's D1 migration tracker. `db:seed:local` loads explicitly fictional baseline facility and role records after migrations; it is local-only. To verify every migration and the seed against a disposable, empty local D1 database without touching the normal local database, run `npm run db:test:migrations:local`. The legacy Drizzle journal is not used by this Wrangler-based migration path.

For a real Cloudflare D1 database, copy `.env.example` to the ignored `.env.local` and set `D1_DATABASE_ID` to that database's exact UUID and `D1_DATABASE_NAME` to its configured name. Review pending changes with `npm run db:migrations:list` before applying them with `npm run db:migrate:remote`. Remote commands refuse to run with a missing, malformed, or local-placeholder database ID. Do not point these commands at a production database until the migration has been reviewed and a backup/restore procedure is in place.

## Product architecture

- **SecureVisit Control → Operations:** Command Center, Appointments, Waiting Room, Live Sessions, Resources, and Incidents.
- **SecureVisit Control → Management:** People, Visitation, Finance, Compliance, Facility, and Administration.
- **SecureVisit Visitor:** Separate external-user experience at `/visitor` with Home, Visits, Connections, Credits, and Account.
- **SecureVisit Kiosk:** Restricted controlled-device experience at `/kiosk/visits/:visitId/live`; it is not exposed as a staff mode.

Each workspace uses a different interaction pattern: timelines and action center for operations, queues and case views for decisions, resource grids for live capacity, configuration forms for management, and mobile-first flows for visitors.

## MVP scope

- Staff dashboard for Central Facility
- Approval queue with approve / decline interactions
- Daily appointment agenda and room status
- Visitor portal preview via the Staff view toggle
- Fictional records remain in several Control dashboards and People tabs; the Visitor Connections flow and People → Verifications queue use persisted facility-scoped APIs
- Audit activity surface and secure-mode messaging
- Persisted visitor profile, relationship verification/evidence review, prisoner, and appointment workflow APIs
- LiveKit-backed Live Session V1 with visitor and controlled kiosk routes, scoped tokens, timer, reconnect states, staff monitoring authorization, and completion lifecycle
- Kiosk LiveKit tokens require a per-device, revocable credential; a kiosk ID by itself is not authentication
- Responsive layout for desktop and smaller screens

## Production boundaries

Before institutional use, the platform still needs configured institutional OIDC/SAML authentication, a real visitor delivery provider, a real payment adapter, full resource/policy enforcement, notification delivery adapters, immutable audit export, provider operations, and legal/privacy review. Verification evidence metadata, retention policies, and legal holds are modeled; evidence upload and protected reviewer access require an R2 `EVIDENCE_BUCKET` binding and fail closed without it. Every successful staff file access is audited; files are never exposed through public or presigned URLs. Scheduled purge still needs operational verification. Recordings remain disabled.

The checkout adapter requires `VISIT_CREDIT_PRICE_MINOR` to be set to the institution-approved per-credit price in production. The local development fallback of 50,000 IDR is explicitly labeled as an example price and must not be treated as an approved tariff. The configured checkout service must honor the stable payment-intent idempotency key, return an HTTPS checkout URL, and send signed, idempotent payment events before any real purchase can be considered pilot-ready.

Operational checks: run `npm run db:migrations:list` against the target D1 database, apply migrations with the matching `db:migrate:*` command, then verify `/api/health/readiness` before opening the pilot to users. Production Worker startup rejects requests when required provider bindings and secrets are missing.

Visitor scheduling is policy-backed: `/api/visitor/availability` returns facility-scoped slots after relationship approval, and appointment creation revalidates facility state, operating hours, booking horizon, duration, visitor overlap, and prisoner overlap server-side.

Resource recovery is facility-scoped and transactional: staff with appointment-review permission can send `reassign_appointment` to `/api/control/resources` with source/target resource IDs, expected resource and Waiting Room versions, and a reason. The command swaps the reservation, updates the Waiting Room assignment, and writes audit/outbox records together; unhealthy, unavailable, cross-type, conflicting, or stale targets are rejected.

## Backend foundation

The project now includes a D1-backed security foundation with workspace identity checks, facility-scoped permissions, audit/outbox records, versioned facility-state changes, and security headers. See [SECURITY.md](SECURITY.md) for setup and limitations.
