# Validation — 2026-11-26

## PASS — local synthetic validation

Command: `npm test` with Node v24.20.0. Three test groups passed, zero failures, zero skips:

1. Required fields, at least one contact, invalid contacts, Arabic digits, enum validation, two-goal limit, conditional other fields, malformed types, unsafe URL schemes/credentials, and a service business submission.
2. HTTP integration: origin denial, honeypot, invalid/too-young/expired tokens, content type, malformed JSON, 32 KiB limit, invalid answers, SQLite persistence, injected insert failure with rollback and successful retry, identical-request replay, changed-intent conflict, rate limits, blocked access to server/data/test files, and existing page routes. Database survived closing/reopening the server. Fresh challenge allows replay after expiration without a duplicate submission.
3. Independent processes / SQLite connections: ten concurrent submissions of the same request across two servers produced exactly one 201 and nine 200 responses with the same durable result ID.

The isolated sandbox initially denied loopback access (`connect EACCES`); rerun with local network permission passed. That tooling denial was not reported as an application failure or a passing test. Temporary test databases and child processes were cleaned up by the test harness.

`node --check` passed for frontend modules and server.

## PASS — browser, local only

- Required-field errors prevented advancing and focused the first invalid field.
- Synthetic brand, contact, and email remained when navigating back from step 2.
- Completed all six steps with service-oriented synthetic data and optional sections empty.
- Submission displayed a durable receipt and explicitly distinguished the brief from booking confirmation.
- SQLite inspection confirmed one local browser-test record, status `new`, schema version 1. No production data was used.
- At 390 × 844, found and fixed RTL horizontal overflow caused by the honeypot. Recheck reported viewport width 390 and document scrollWidth 375, with no horizontal overflow. Header, personal logo, form and choice styling visually reviewed. Temporary viewport override reset.

## BLOCKED — production

Actual Render service settings and durable storage are unavailable: owner stated the connected Render workspace is not the hosting account. No main merge/push or production deployment was performed. An existing static frontend plus GitHub auto-deploy does not itself provide durable server storage.

Production proxy identity/rate-limiting integration, disk/backup configuration and restore proof, production persistence across a deploy, and live submission smoke: **NOT RUN**. Full cross-browser and assistive-technology audit: **NOT RUN**. Actual customer completion time: **NOT MEASURED**.

Existing production source pages were not edited. Locally, their HTTP routes passed; full interactive regression of every existing page was not run. Dashboard, accounts and subdomain work: **NOT STARTED**.
