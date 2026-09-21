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

Before institutional use, the platform needs institutional OIDC/SAML authentication, visitor passwordless authentication, verified payment webhooks, protected evidence storage, full resource/policy enforcement, notification workers, recording access approvals, immutable audit export, retention controls, provider operations, and legal/privacy review. The current visitor and payment provider boundaries are still development-only.

## Backend foundation

The project now includes a D1-backed security foundation with workspace identity checks, facility-scoped permissions, audit/outbox records, versioned facility-state changes, and security headers. See [SECURITY.md](SECURITY.md) for setup and limitations.
