# SecureVisit

SecureVisit is a staff-first prototype for controlled correctional visitation operations. It brings the approval queue, facility schedule, room readiness, live-session control, credit activity, visitor portal preview, and audit trail into one calm operations workspace.

This build is still an MVP, but persisted D1 workflows now cover visitor connection requests, facility-scoped verification decisions, appointment requests/decisions, credit balances, and payment-intent records. Visitors can authenticate with an email or E.164 phone OTP; the delivery adapter is still provider-neutral and must be connected to a real email/SMS service before pilot use. Visitors can attach identity/relationship evidence when the protected R2 bucket is configured; reviewers can open available evidence through a facility-authorized route that writes an audit event. Verification approval is blocked until required evidence is available. The Visitor Credits screen can create a configured provider checkout and display persisted balances, ledger activity, and payment status; no real payment provider is enabled by default, so it does not process real payments until the adapter and webhook are configured and tested. The first pilot does not yet integrate with an external prisoner system. When configured, video media uses LiveKit WebRTC and recordings remain disabled by default.

## Run locally

```bash
npm install
npm run dev
```

To choose a port, pass it through to Vinext, for example `npm run dev -- --port 5174`, then open `http://localhost:5174`. This is a full-stack development server: the page and its `/api/*` routes share that origin. There is no separate backend-only server on port 8001 in this project.

For a new local checkout, `npm run dev:local -- --port 5174` applies the local D1 migrations, loads the fictional development seed, and then starts the same full-stack server. It is safe to run repeatedly; migrations and seed operations are idempotent.

If you want to exercise a real LiveKit development project locally, set `VIDEO_PROVIDER=livekit`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in the ignored `.env.local`. The local Worker receives those values server-side; the credentials are not exposed to the browser. Staging and production must use separately managed Cloudflare secrets.

The production checks are:

```bash
npm run build
npm run lint
npm run typecheck
npm run validate:environment
npm test
```

For a faster test pass that skips the production build, run `npm run test:quick`. It uses the repository's `tsx` loader so tests that import TypeScript modules resolve consistently.

For one repeatable local release gate, run `npm run verify:release`. It runs the disposable migration check, typecheck, lint, build/server tests, browser tests, and a production-only dependency audit. It does not deploy or mutate a remote database; staging still requires the acceptance runbook and external-provider evidence.

After building a staging or production Worker, run `npm run validate:deployment -- --environment=staging` (or `production`). This preflight inspects the generated Wrangler manifest and fails if it still contains development adapters, the local D1 placeholder, no protected `EVIDENCE_BUCKET` binding, or no scheduled reconciliation trigger. It does not replace Cloudflare deployment verification or provider acceptance testing.

For a generated staging/production manifest, provide `D1_DATABASE_ID`, `D1_DATABASE_NAME`, and `EVIDENCE_BUCKET_NAME` to the build environment. The build uses those values for the D1 and R2 bindings; if they are absent, it intentionally keeps the local placeholder and the deployment preflight fails closed.

Non-development builds intentionally do not inherit provider or resource values from `.env.local`; inject every staging/production value through the deployment environment or secret store.

Use `npm run deploy:staging:dry-run` or `npm run deploy:production:dry-run` for an environment-specific packaging check. These commands must pass the generated-manifest preflight before Wrangler is allowed to produce its dry-run upload plan. They do not deploy or mutate Cloudflare resources.

For a redacted readiness summary, run `npm run audit:pilot`. It reports environment configuration, remote D1 identity, protected evidence storage, provider readiness, and release evidence without printing secret values. Add `npm run audit:pilot -- --strict` in a staging or production check when the command should exit non-zero until the pilot gates are satisfied.

To verify the Cloudflare Worker packaging without deploying or changing a remote service, run:

```bash
npm run deploy:dry-run
```

This builds the Worker and asks Wrangler to resolve the generated bindings and upload manifest in dry-run mode. A successful dry run does not prove that Cloudflare resources, secrets, domains, or provider credentials are configured; use the staging runbook and `/api/health/readiness` before deployment.

### Local D1 database

Apply the checked-in SQL migrations before exercising persisted workflows:

```bash
npm run db:migrations:list:local
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Before running browser tests against the local Worker, run the migration and seed commands above. The browser suite uses the same persisted `.wrangler/state` D1 database; a stale local schema can otherwise surface as an internal API error when a route references a newly added migration column. CI performs this preparation automatically.

Both the app's local Worker binding and the migration command use the same local D1 binding name, placeholder ID, and `.wrangler/state` persistence directory. Local migration commands do not require Cloudflare credentials. The SQL files in `drizzle/` are the migration source of truth and are applied by Wrangler's D1 migration tracker. `db:seed:local` loads explicitly fictional baseline facility and role records after migrations; it is local-only. To verify every migration and the seed against a disposable, empty local D1 database without touching the normal local database, run `npm run db:test:migrations:local`. The legacy Drizzle journal is not used by this Wrangler-based migration path.

For a real Cloudflare D1 database, copy `.env.example` to the ignored `.env.local` and set `D1_DATABASE_ID` to that database's exact UUID and `D1_DATABASE_NAME` to its configured name. Review pending changes with `npm run db:migrations:list` before applying them with `npm run db:migrate:remote`. Remote commands refuse to run with a missing, malformed, or local-placeholder database ID. Remote migrations and backups also require `SECUREVISIT_ENVIRONMENT=staging` or `production`; local development cannot target a remote database. Do not point these commands at a production database until the migration has been reviewed and a backup/restore procedure is in place.

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
- Control dashboards and People tabs load facility-scoped records from protected APIs; development-only simulation controls are explicitly labeled and never change facility records
- Audit activity surface and secure-mode messaging
- Persisted visitor profile, relationship verification/evidence review, prisoner, and appointment workflow APIs
- Visitor account contact verification for SMS numbers, with visitor-bound OTP challenges, session-protected verification, audit, and notification outbox records
- LiveKit-backed Live Session V1 with visitor and controlled kiosk routes, scoped tokens, timer, reconnect states, staff monitoring authorization, and completion lifecycle
- Kiosk LiveKit tokens require a per-device, revocable credential; a kiosk ID by itself is not authentication
- Responsive layout for desktop and smaller screens

## Production boundaries

Before institutional use, the platform still needs configured institutional OIDC/SAML authentication, a real visitor delivery provider, a real payment adapter, full resource/policy enforcement, notification delivery adapters, immutable audit export, provider operations, and legal/privacy review. Verification evidence metadata, retention policies, and legal holds are modeled; evidence upload and protected reviewer access require an R2 `EVIDENCE_BUCKET` binding and fail closed without it. Every successful staff file access is audited; files are never exposed through public or presigned URLs. Scheduled purge still needs operational verification. Recordings remain disabled.

The checkout adapter reads the institution-approved per-credit price from the facility's versioned Visit Policy (`credit_price_minor` and `credit_currency`). Existing non-development facilities remain unavailable for checkout until staff explicitly configures that policy value. `VISIT_CREDIT_PRICE_MINOR` is retained only as a local development fallback; the local seed uses 50,000 IDR as an example price and it must not be treated as an approved tariff. The configured checkout service must honor the stable payment-intent idempotency key, return an HTTPS checkout URL, and send signed, idempotent payment events before any real purchase can be considered pilot-ready.

Operational checks: run `npm run validate:environment` with the target environment variables, run `npm run db:migrations:list` against the target D1 database, apply migrations with the matching `db:migrate:*` command, then verify `/api/health/readiness` before opening the pilot to users. The validator prints only missing configuration names and warnings; it never prints secret values. Production Worker startup also rejects requests when required provider bindings and secrets are missing.

The staging release gate is documented in [docs/STAGING_ACCEPTANCE_RUNBOOK.md](docs/STAGING_ACCEPTANCE_RUNBOOK.md). It covers provider setup, the refresh-safe visitor → staff → kiosk → LiveKit journey, failure rehearsals, evidence collection, rollback, and institutional go/no-go approval. Local adapters and passing automated tests are not a substitute for this staging run.

Visitor scheduling is policy-backed: `/api/visitor/availability` returns facility-scoped slots after relationship approval, and appointment creation revalidates facility state, operating hours, booking horizon, duration, visitor overlap, and prisoner overlap server-side.

Resource recovery is facility-scoped and transactional: staff with appointment-review permission can send `reassign_appointment` to `/api/control/resources` with source/target resource IDs, expected resource and Waiting Room versions, and a reason. The command swaps the reservation, updates the Waiting Room assignment, and writes audit/outbox records together; unhealthy, unavailable, cross-type, conflicting, or stale targets are rejected.

## Backend foundation

The project now includes a D1-backed security foundation with workspace identity checks, facility-scoped permissions, audit/outbox records, versioned facility-state changes, and security headers. See [SECURITY.md](SECURITY.md) for setup and limitations.
