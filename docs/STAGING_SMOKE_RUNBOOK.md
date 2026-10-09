# SecureVisit staging smoke runbook

`npm run staging:smoke` is a deployment check for the staging environment. It is intentionally separate from the local release verifier: local tests prove repository behavior, while this command checks the deployed origin and its configured readiness contract.

## Required environment

Set `STAGING_DOMAIN` to the HTTPS staging origin. The command checks:

- `/api/health/live` returns `200` and `{ "status": "ok" }`;
- `X-Content-Type-Options` and `Referrer-Policy` are present;
- camera and microphone are allowed by `Permissions-Policy`;
- CSP contains same-origin connections and `frame-ancestors 'none'`.

The authenticated readiness check is required by default. Set the staff session cookie using a short-lived staff session only:

```powershell
$env:STAGING_READINESS_COOKIE = 'securevisit_staff_session=...'
$env:STAGING_SMOKE_REQUIRE_READINESS = 'true'
npm run staging:smoke
```

The readiness response must report a ready schema, configured providers, and all release gates approved. The command never prints the credential value.

For a public deployment check without staff credentials, explicitly downgrade the check:

```powershell
$env:STAGING_SMOKE_REQUIRE_READINESS = 'false'
npm run staging:smoke
```

That mode is not sufficient for a pilot release. It only proves reachability and public security headers.

## Evidence to retain

For each staging run, retain the date, deployment revision, staging domain, command result, readiness response summary, and operator. Do not retain cookies, bearer tokens, provider secrets, or response bodies containing sensitive facility information.

This smoke check does not replace the full acceptance journey in `STAGING_ACCEPTANCE_RUNBOOK.md`. It must be followed by visitor, kiosk, staff, payment, LiveKit, notification, backup/restore, and failure-recovery tests.
