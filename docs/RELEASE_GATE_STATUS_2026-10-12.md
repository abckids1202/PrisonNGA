# SecureVisit Release Gate Status — 2026-10-12

This is the dated release-review snapshot for the current repository. It separates
repository evidence from staging evidence and external institutional approvals.

## Verified repository baseline

The following command completed successfully on the current `main` baseline
commit `1e01c23`:

```text
npm run verify:release
```

It verified:

- 75 API route files represented in the security matrix, with no uncovered routes.
- Fresh local D1 migrations and seed verification.
- Disposable fresh-schema execution of the synthetic staging fixture.
- Disposable local D1 backup/restore with schema, foreign-key, credit-ledger, and audit-integrity checks.
- TypeScript typecheck.
- ESLint.
- Production build.
- 568 server test cases.
- 17 browser tests.
- Production dependency audit with 0 vulnerabilities.

The pilot audit also fails closed when staging/production declare the R2 storage
provider without naming the protected `EVIDENCE_BUCKET_NAME` binding.

This is engineering evidence only. It does not prove external provider,
hardware, deployment, resilience, legal, or institutional readiness.

The full verifier was rerun on `1e01c23` after the People, verification, Incidents, and
Administration workspaces were extracted from the Control shell and the guarded staging
fixture workflow gained a fresh-schema compatibility check. The current repository baseline is therefore
release-verified locally. This remains engineering evidence only and does not
satisfy external provider, staging, hardware, resilience, legal, or
institutional gates.

## Pilot gate status

| Gate | Current status | Required evidence before pilot |
| --- | --- | --- |
| Staging domain and remote D1 | NOT STARTED | HTTPS staging deployment, remote D1 identity, migration record, readiness response |
| Visitor email delivery | CODE READY / NOT PROVEN | Provider-domain verification, delivered OTP, bounce/failure handling, retry and outage evidence |
| Visitor SMS delivery | CODE READY / NOT PROVEN | Verified sender, delivered OTP, invalid-number behavior, delivery callback and outage evidence |
| Staff OIDC | CODE READY / NOT PROVEN | Institutional IdP, MFA claim, group/facility mapping, disabled-account and logout tests |
| Staff SAML | CODE READY / NOT PROVEN | Signed metadata/assertion, MFA context, replay protection and logout tests |
| Visit tariff | NOT APPROVED | Signed Indonesian tariff decision and facility policy record |
| Refund/cancellation policy | NOT APPROVED | Signed policy covering cancellation, no-show, technical failure, refund and dispute outcomes |
| Payment checkout | XENDIT ADAPTER + CALLBACK READY / NOT PROVEN | Xendit sandbox checkout, callback, refund, dispute and reconciliation evidence |
| Payment reconciliation | CODE READY / NOT PROVEN | Duplicate, delayed, disputed, refunded and provider-outage reconciliation evidence |
| Protected evidence storage | CODE READY / NOT PROVEN | Private R2, scanner quarantine/rejection, signed staff access, purge and legal-hold evidence |
| Kiosk enrollment | CODE READY / NOT PROVEN | Real device enrollment, credential rotation/revocation, replacement and offline recovery |
| Three-party video | CODE READY / NOT PROVEN | Visitor, kiosk and staff observer staging session with reconnect and termination evidence |
| Remote disaster recovery | LOCAL ONLY | Remote D1/R2 backup, clean restore, measured RPO/RTO and ledger/audit verification |
| WAF and rate limits | APPLICATION ONLY | Cloudflare WAF/bot/rate-limit configuration and attack/abuse test evidence |
| Monitoring and alerting | PARTIAL | External log sink, dashboards, alert routing, secret rotation and on-call ownership |
| Operational runbooks | DOCUMENTED / NOT REHEARSED | Identity, payment, messaging, video, kiosk, storage and rollback tabletop exercises |
| Independent security review | NOT STARTED | Signed review or penetration-test report with remediation disposition |
| Indonesian privacy/correctional approval | NOT STARTED | Signed privacy, retention, identity-verification and correctional-policy approval |

## Known deliberate development-only behavior

These must remain unavailable in staging and production:

- Fictional local seed data.
- Development OTP delivery.
- Local payment adapter.
- Local video transport.
- Control simulation controls.
- Development secrets and local placeholder D1 bindings.

The deployment validator and strict pilot audit must be run against the target
environment before any pilot access is opened.

## Required next release slice

The next implementation/release slice is a staging vertical slice, in this
order:

1. Create isolated staging Cloudflare resources and remote D1/R2 bindings.
2. Select and configure one visitor email provider and one SMS provider, or formally approve email-only authentication.
3. Configure institutional staff identity with MFA and facility/role claims.
4. Approve and persist the tariff and cancellation/refund policy.
5. Select one payment provider and test checkout, webhook, refund, dispute, and reconciliation behavior.
6. Configure LiveKit staging and enroll one real kiosk.
7. Execute the complete visitor → staff → kiosk → LiveKit → completion journey after refresh and duplicate requests.
8. Add provider outage, delayed webhook, reconnect, cancellation, no-show and restore evidence.
9. Complete operational, security, privacy and institutional sign-off.

No local test result should be recorded as satisfying one of these staging or
institutional gates.
