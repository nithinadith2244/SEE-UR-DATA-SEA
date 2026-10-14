# Have I Been Pwned (HIBP) integration

This replaces the earlier "no provider, always unavailable" default. Email breach lookups now go **browser -> this site's own server -> HIBP**. The key exists only on the server.

## Why a server is required (documented by HIBP)

- Email search (`GET /api/v3/breachedaccount/{email}`) needs an `hibp-api-key` header.
- HIBP states that CORS is supported only for non-authenticated APIs and that keyed APIs "should not be hit directly from the client side". A browser-only site therefore **cannot** perform a real lookup. That was the actual defect: the project had no HIBP integration and no backend, so no search could ever return a real answer.
- Every request needs a `user-agent` header (a missing one returns HTTP 403).
- Source: <https://haveibeenpwned.com/API/v3>

## Two modes, kept strictly separate

| | **Test mode** | **Production mode** (default) |
| --- | --- | --- |
| Selected by | `HIBP_MODE=test` (server environment only) | `HIBP_MODE` unset or `production` |
| Key used | HIBP's documented test key, hard-coded server-side, **only** ever sent to HIBP | `HIBP_API_KEY` (server-only env var) |
| `HIBP_API_KEY` set? | Server **refuses** to run (reports "not configured") so a real key can never be used or leaked by test mode | Required |
| Accepts | Only `@hibp-integration-tests.com` addresses | Everything **except** `@hibp-integration-tests.com` |
| Real address submitted | Rejected (`test_mode_domain_only`), no lookup made | Normal lookup |
| UI | Banner "Test mode" and every result labelled "Test mode:" with a note that it is synthetic | No test labelling |

Neither mode can be switched from the browser.

## Production behaviour

- `HIBP_API_KEY` missing, malformed (not 32 hex characters) or equal to the documented test key: every search returns **"Live email breach lookup is not configured yet."** (HTTP 503, `state: "not_configured"`). No request is made to HIBP.
- The key is read only in `server/handler.js` / `server/hibp.js`, is sent only in the `hibp-api-key` header to `https://haveibeenpwned.com`, and is never put in a response, a header, an error message or a log (the server has no logging).

### How HIBP's HTTP statuses are interpreted

Implemented once, in `classifyResponse()` (`server/hibp.js`), and covered by a table test that sweeps every status 100-699.

| HIBP status | Our outcome | User sees |
| --- | --- | --- |
| 200 + valid breach list | `breached` | Breach cards with source attribution |
| 200 + empty / unreadable / malformed list | `error: invalid_response` | Unavailable (answer could not be verified) |
| **404 (and only 404)**, not an HTML error page | `not_found` | "No match found" with its not-a-promise-of-safety caveat |
| 404 that is an HTML page | `error: unexpected_status` | Unavailable |
| 400 | `error: bad_request` | Unavailable (request not accepted) |
| 401 | `error: authentication` | Unavailable: the service rejected this site's credentials |
| 403 | `error: access_denied` | Unavailable: access denied |
| 429 | `error: rate_limited` (+ `retry-after`) | Unavailable with a retry hint |
| 5xx (incl. Cloudflare 503) | `error: server_error` | Unavailable |
| timeout / network failure | `error: timeout` / `network` | Unavailable |
| anything else | `error: unexpected_status` | Unavailable |

A "no match" is never produced by an unexecuted, failed or ambiguous request. The browser adds a second check: it shows "no match" only when our server answered HTTP 200 **and** reports `upstreamStatus === 404`. If the `/api` route is missing (for example on plain static hosting), the host's own 404 page is not JSON, so the browser shows "unavailable".

Known residual risk: a genuine-looking JSON 404 from a wrong URL path would be read as "not found". The integration test guards against this by proving the exact path works (HTTP 200 for `account-exists`) before you rely on 404s.

## API contract

`POST /api/check` with `{"email": "..."}` (JSON, max 1 KB, same-origin only). Responses always carry `mode`, `upstreamStatus` (number or null) and, where relevant, `source`. No response ever contains the key.

`GET /api/status` returns `{state: "ready", mode}` or `{state: "not_configured", message, mode: null}`.

Also enforced: origin check (other sites cannot spend your quota through a visitor's browser), content-type and size limits, per-IP rate limit (10/min by default, memory only), `no-store` caching.

## Run the controlled integration test

```bash
npm run test:integration
```

It starts the real server in test mode with a **clean environment** (your shell's `HIBP_API_KEY` is ignored on purpose), queries the official test accounts, runs the real response through the browser-side code, and prints the observed statuses. Exit codes: `0` passed, `1` reached HIBP but a check failed, `2` inconclusive because HIBP could not be reached.

Checks: `account-exists@hibp-integration-tests.com` returns HTTP 200 with a breach list (documented: one breach); `opt-out@hibp-integration-tests.com` returns a genuine HTTP 404 classified as `not_found`; test mode refuses a real-looking address; the key appears in no response.

## Run it locally

```bash
npm run dev:test          # test mode, open http://localhost:8080, search account-exists@hibp-integration-tests.com
cp .env.example .env      # then put your key in .env (git-ignored)
node --env-file=.env server/start.mjs    # production mode
```

## Deploy (Cloudflare Pages)

`functions/api/check.js` and `functions/api/status.js` are Pages Functions that reuse the same handler. In the Pages project add **HIBP_API_KEY** as an **encrypted environment variable (secret)** for Production. Do not set `HIBP_MODE` in production. Add a Cloudflare rate-limiting rule for `/api/check` as well: the built-in limiter is per instance and best effort. See `docs/DEPLOYMENT.md`.

## Attribution and terms

HIBP's breach API is licensed CC BY 4.0: you must clearly attribute Have I Been Pwned with a link wherever its data appears. Every result card section shows "Data source: Have I Been Pwned" with a link. HIBP also forbids misrepresenting the data's source and requires an accurate user agent (`SEE-UR-DATA-breach-checker` by default). Read <https://haveibeenpwned.com/TermsOfUse> before launch. Operating a public lookup service on a paid key is your decision and your cost: each visitor lookup spends your subscription's quota.
