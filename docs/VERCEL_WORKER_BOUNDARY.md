# Vercel frontend / Cloudflare Worker boundary

SecureVisit keeps the Cloudflare Worker authoritative. Vercel hosts the
visitor, Control, and kiosk frontend assets; it must not become a second
business-logic implementation.

Set these separately for Preview/Staging and Production:

```text
PUBLIC_APP_URL=https://staging.example.org
WORKER_API_ORIGIN=https://staging-api.example.org
SECUREVISIT_VERCEL_DEPLOYMENT=true
```

Both values must be HTTPS origins without paths, credentials, query strings, or
fragments. `WORKER_API_ORIGIN` is configuration, not a secret. Provider
credentials remain in Cloudflare/Vercel secret stores and never reach the
browser.

Configure a Vercel external-origin rewrite for every API path, preserving the
browser-visible path so cookies and CSRF checks remain same-origin:

```json
{
  "source": "/api/:path*",
  "destination": "https://<WORKER_API_ORIGIN>/api/:path*"
}
```

Replace the placeholder with the environment's Worker origin in the Vercel
project configuration. Do not use a redirect or cache `/api/*`; the Worker
returns `Cache-Control: no-store` for authenticated and mutation responses.

Staging acceptance must prove that `/api/health/live` reaches the Worker, an
authenticated cookie survives the rewrite, same-origin mutations pass the CSRF
boundary, cross-origin mutations are rejected, and OIDC/SAML callback URLs use
the public Vercel origin. CSP and Permissions Policy must also allow the
configured LiveKit origin.

The `vercel-build` command fails closed when a Vercel build is missing either
origin. It validates configuration shape only; it does not prove DNS, cookies,
provider callbacks, or staging acceptance.
