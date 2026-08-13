# SecureVisit

SecureVisit is a staff-first prototype for controlled correctional visitation operations. It brings the approval queue, facility schedule, room readiness, credit activity, visitor portal preview, and audit trail into one calm operations workspace.

This build is intentionally an MVP using fictional data only. It does not process real payments, connect to a live prisoner database, transmit video, or store recordings.

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

## MVP scope

- Staff dashboard for Central Facility
- Approval queue with approve / decline interactions
- Daily appointment agenda and room status
- Visitor portal preview via the Staff view toggle
- Fictional visitor, prisoner, appointment, and credit data
- Audit activity surface and secure-mode messaging
- Responsive layout for desktop and smaller screens

## Production boundaries

Before institutional use, the platform needs real authentication and facility-scoped authorization, a transactional credit ledger, verified payment webhooks, protected document storage, a policy-driven video provider, recording access approvals, immutable audit storage, retention controls, and legal/privacy review. The prototype keeps those high-risk systems out of scope on purpose.

## Backend foundation

The project now includes a D1-backed security foundation with workspace identity checks, facility-scoped permissions, audit/outbox records, versioned facility-state changes, and security headers. See [SECURITY.md](SECURITY.md) for setup and limitations.
