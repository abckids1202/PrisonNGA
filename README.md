# SecureVisit

SecureVisit is a staff-first prototype for controlled correctional visitation operations. It brings the approval queue, facility schedule, room readiness, live-session control, credit activity, visitor portal preview, and audit trail into one calm operations workspace.

This build is still an MVP, but its first persisted institutional workflow is now represented in D1: facility-managed prisoner records, visitor profiles, relationship verification, and appointment requests/decisions. It does not process real payments yet or integrate with an external prisoner system. When configured, video media uses LiveKit WebRTC and recordings remain disabled by default.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vinext. The production checks are:

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

Both the app's local Worker binding and the migration command use the same local D1 binding name and placeholder ID. Local migration commands do not require Cloudflare credentials. The SQL files in `drizzle/` are the migration source of truth and are applied by Wrangler's D1 migration tracker. `db:seed:local` loads explicitly fictional baseline facility and role records after migrations; it is local-only. Drizzle Kit generation is intentionally not exposed as an npm script while the legacy snapshot journal is being reconciled.

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
- Fictional visitor, prisoner, appointment, and credit data
- Audit activity surface and secure-mode messaging
- Persisted visitor profile, relationship verification, prisoner, and appointment workflow APIs
- LiveKit-backed Live Session V1 with visitor and controlled kiosk routes, scoped tokens, timer, reconnect states, staff monitoring authorization, and completion lifecycle
- Responsive layout for desktop and smaller screens

## Production boundaries

Before institutional use, the platform still needs configured institutional OIDC/SAML authentication, a real visitor delivery provider, a real payment adapter, full resource/policy enforcement, notification delivery adapters, immutable audit export, provider operations, and legal/privacy review. Verification evidence metadata, retention policies, legal holds, and scheduled purge are now modeled; raw evidence upload remains fail-closed until an R2 `EVIDENCE_BUCKET` binding is configured. Recordings remain disabled.

Operational checks: run `npm run db:migrations:list` against the target D1 database, apply migrations with the matching `db:migrate:*` command, then verify `/api/health/readiness` before opening the pilot to users. Production Worker startup rejects requests when required provider bindings and secrets are missing.

Visitor scheduling is policy-backed: `/api/visitor/availability` returns facility-scoped slots after relationship approval, and appointment creation revalidates facility state, operating hours, booking horizon, duration, visitor overlap, and prisoner overlap server-side.

## Backend foundation

The project now includes a D1-backed security foundation with workspace identity checks, facility-scoped permissions, audit/outbox records, versioned facility-state changes, and security headers. See [SECURITY.md](SECURITY.md) for setup and limitations.
