# SEE UR DATA

> **Know what the internet knows about you.**

A small, privacy-first website that tells people whether their email address appears in publicly documented data breaches (via Have I Been Pwned), with every result tied to a named source.

It is plain HTML, CSS and JavaScript plus a small zero-dependency Node/Cloudflare server component for the Have I Been Pwned lookup. There is **no build step, no dependency to install, no tracking and no database**, and the HIBP API key lives only on the server.

---

## Read this first: what works today, and what is still unproven

| | Status |
| --- | --- |
| Website, search, validation, loading / error / empty / result states, policy pages | **Built and tested** |
| **Free lookups, no API key** via XposedOrNot (the default provider) | **Built and tested against the provider's documentation and a local stand-in.** Not yet observed against the real service: the build environment cannot reach `api.xposedornot.com`. |
| Two lookup routes: browser-direct, with automatic fallback to this site's `/api/xon` relay | **Built and tested** |
| Optional paid Have I Been Pwned route (server-side key, test mode, production mode) | **Built and tested locally**; needs your key |
| Proof against the real services | **One command each, run on your machine:** `npm run verify:free-api` and `npm run test:integration` |

**To make it 100% real, do this once on a machine with internet access:**

```bash
npm run verify:free-api      # one real request to the free API; prints the HTTP status, whether browsers are allowed (CORS), and how this site reads the answer
npm test                     # 109 local tests
```

Exit code `0` from the first command means the free API answered in the documented format and the site understands it. If it prints "CORS: NOT granted", the site automatically uses its relay instead, which works but shares one allowance across all visitors.

**Be clear-eyed about "free":**

- XposedOrNot's free tier is limited **per IP address: 25 lookups per hour and 100 per day**, and it is described as for "personal and low-volume use"; products built on it are pointed to a paid plan. A public site with real traffic may exceed that. This is the provider's rule, not something the code can change. See `docs/PROVIDERS.md`.
- With the browser-direct route each visitor has their own allowance, which is why it is tried first. The relay route shares **one** allowance (20 per hour across all visitors by default), so it is a low-volume fallback.
- No free source covers every breach. "No match" is never proof of safety, and the site says so every time.

**What the site will never do:** show "no match" unless the provider returned its documented "nothing found" answer; treat a rate limit, error, timeout, network failure or unreadable answer as "no breaches"; invent breach records; use test data for real addresses; or print any key (the free route has no key at all).

---

## The three outcomes

The interface keeps these visibly separate, with text labels and not colour alone:

| Outcome | Shown when | Never means |
| --- | --- | --- |
| **Listed in a documented breach** | A named source returned a valid record and at least one record is marked verified by that source | that the data is being misused |
| **No match found** | The source returned its documented, complete "nothing found" response | that the address is safe |
| **Unavailable or inconclusive** | No provider, network error, timeout, rate limit, unrecognisable response, or only unverified matches | anything either way |

---

## Quick start (beginners)

### 1. Install Node.js

Download the LTS version from <https://nodejs.org> (version 20 or newer). Check it worked:

```bash
node --version
```

### 2. Get the code

Unzip the project, then open a terminal in the folder (the one containing `index.html`).

### 3. Run the tests

```bash
npm test
```

You should see all tests pass. There is nothing to `npm install`.

### 4. Run the site locally

```bash
npm run dev
```

Open <http://localhost:8080>. (To use another port: `PORT=3000 npm run dev` on macOS/Linux.) Press `Ctrl+C` to stop. The server sends the same security headers as production, so a broken Content-Security-Policy shows up on your machine too.

Try it:

- Submit nothing, or `plainaddress`: you get a specific error.
- Submit your **own** email address. With internet access you get a real, source-attributed answer from the free service (or an honest "unavailable" if it is rate-limited or unreachable).
- Optional paid route: set `provider: "hibp-server"` in `js/config.js`, then either `npm run dev:test` and search `account-exists@hibp-integration-tests.com` (HIBP's free test account, labelled "Test mode"), or put your key in `.env` (see `.env.example`) and run `node --env-file=.env server/start.mjs`.

> Opening `index.html` by double-clicking will not work, because browsers block JavaScript modules on `file://` pages. Use `npm run dev`.

### 5. Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Server on port 8080: static site, `/api/xon` relay, and the HIBP routes (production mode) |
| `npm run dev:test` | Same server in **test mode** (official HIBP test accounts only) |
| `npm run verify:free-api` | One real request to the free XposedOrNot API: status, CORS verdict, parser verdict (needs internet) |
| `npm run test:integration` | Controlled test against the real HIBP test accounts (optional paid route; needs internet) |
| `npm test` | Runs all unit and local end-to-end tests (Node's built-in runner) |
| `npm run check` | Checks every local link in the HTML pages |

There is no build command and nothing to install.

---

## Project layout

```
index.html              Home page and search (must stay in the repository root)
methodology.html        How results are produced; what each outcome means
limitations.html        What the site cannot tell you
privacy.html            What is stored (nothing) and what is sent
contact.html            Contact methods, taken from js/config.js
favicon.svg  robots.txt  .env.example
_headers                Cloudflare Pages security headers (CSP, HSTS, ...)
css/styles.css          All styling (system fonts, no external requests)
js/
  config.js             Public settings: provider, contact, client limits
  email.js              Email validation and normalisation
  url.js                Allows only absolute https links
  result-model.js       The ONLY way to create results (anti-fabrication)
  view-model.js         All user-facing result wording
  rate-gate.js          In-memory request limiter (stores no addresses)
  controller.js         State machine: validate, limit, look up, verify, show
  app.js                DOM binding (textContent only, never innerHTML)
  contact.js            Contact page
  providers/
    index.js            Chooses the provider from config
    xposedornot-auto.js Default: free API, browser-direct first, relay on network failure only
    xposedornot.js      Free API adapter (direct or relay mode), strict response parser
    hibp-server.js      Optional paid route: this site's /api/check -> HIBP (server-side key)
    unconfigured.js     provider "none": no network, always "unavailable"
server/                 SERVER-ONLY code (holds the key; never served to browsers)
  hibp.js               Config/mode resolution, HIBP request, HTTP status classifier
  handler.js            POST /api/check (HIBP), GET /api/status, shared request checks
  xon-relay.js          POST /api/xon: keyless relay for the free API, shared hourly cap
  limiter.js            Per-IP in-memory rate limiter
  app-server.mjs        Node server: static files + API; start.mjs launches it
functions/api/          Cloudflare Pages Functions that reuse server/handler.js
tests/                  109 tests, synthetic data only
docs/                   HIBP.md, PROVIDERS.md, TESTING.md, DEPLOYMENT.md
scripts/                verify-free-api.mjs, integration-test-hibp.mjs, check-links.mjs
```

### How it fits together

```
 form -> controller -> provider (free: XposedOrNot direct, relay fallback | paid: /api/check -> HIBP)
         validates     verifies the envelope     (key lives here)   classifyResponse()
         rate-limits   then result-model mints
         rejects       the only displayable
         forged        result -> view-model
         results       -> app.js (textContent)
```

The browser never talks to HIBP. It talks to this site's own server through a provider object with one method, `lookup(email)`, and only results created by `result-model.js` are ever displayed.

---

## Security and privacy design

- **No secrets in the frontend.** The default free route has no key. The optional HIBP key is a server-only environment variable, read only in `server/`. Tests fail if key-like names, auth headers or 32-hex literals appear in browser code or if the key appears in any response.
- **No storage or tracking.** (The server keeps nothing either: no logging, no database.) No cookies, local/session storage, IndexedDB, analytics, beacons, web fonts or third-party scripts. Searches are not saved. A reload erases everything.
- **No logging.** There are no `console` calls in browser or server code. A test runs every outcome with the console spied and requires silence.
- **Email is never placed in the page URL.** The input has no `name` attribute, so even with JavaScript off a form submission cannot carry it.
- **Strict CSP** (`_headers`): `default-src 'none'`, scripts and styles from the same origin only, no inline code, `connect-src 'self' https://api.xposedornot.com` (the only third-party origin the browser may contact), `frame-ancestors 'none'`, plus HSTS, `nosniff`, no-referrer, a locked-down Permissions-Policy.
- **Safe rendering.** Provider text is inserted with `textContent`. Links must be absolute `https://` URLs with no credentials and carry `rel="noopener noreferrer nofollow"`.
- **Input validation on both sides.** Conservative ASCII email validation in the browser, and the **same validator again on the server** before anything is forwarded, plus origin, content-type and 1 KB size checks.
- **Rate limiting.** Browser: 5/minute, 20/hour per page load (a courtesy). **Server: 10/minute per IP** in memory (best effort on serverless; add a Cloudflare rate-limiting rule for `/api/check`). Client-side limits are never a security control.
- **Passwords are never requested.** The page tells users not to enter one, and nothing in the code accepts one.
- **Outside this project's control:** your host's ordinary server logs, and HIBP's handling of the address it receives (it is part of the request path). The Privacy page says so. Each visitor lookup also spends your HIBP subscription quota.

## Optional: upgrade to Have I Been Pwned (paid key)

1. Buy an HIBP API key at <https://haveibeenpwned.com/API/Key> and read HIBP's terms and attribution rules (`docs/HIBP.md`).
2. Run `npm run test:integration` on a machine that can reach HIBP and confirm exit code 0.
3. Set `HIBP_API_KEY` as a **server-side secret** (Cloudflare Pages: Settings, Variables and Secrets, Production, type Secret). Never put it in `js/`, HTML, `config.js` or Git.
4. Do **not** set `HIBP_MODE` in production.
5. Add a Cloudflare rate-limiting rule for `/api/check`, then work through the deployed-site checklist in `docs/DEPLOYMENT.md`.

The optional browser-side XposedOrNot adapter is still available (`provider: "xposedornot"`, see `docs/PROVIDERS.md`), but it is not the default.

## Tests

`npm test` runs 109 tests covering email validation, HIBP status classification (every HTTP status), test/production mode separation, key non-leakage, real-HTTP end-to-end runs against a **local stand-in** for HIBP, provider success and failure, confirmed and no-match outcomes, rate limits, network errors, fabricated-result prevention, privacy-sensitive logging, security headers, wording accuracy, and static accessibility and responsiveness checks. Details and the manual browser and screen-reader checklist are in `docs/TESTING.md`.

**Known gaps:** the tests do not render the page in a real browser, do not use a screen reader and, apart from `npm run test:integration`, never call the real HIBP (the build environment could not reach it). The checklist covers those by hand.

## Deploy

Full, beginner-friendly steps are in `docs/DEPLOYMENT.md`. In short:

1. Edit `js/config.js` (contact details), run `npm test`.
2. `git init`, commit, create a **public** GitHub repository, push to `main`.
3. In Cloudflare **Workers & Pages**, create a **Pages** project from the repository. Framework preset **None**, build command blank (or `exit 0`), output directory `/`. Nothing else is needed for the free route. Add `HIBP_API_KEY` only if you switch to `hibp-server`.
4. Work through the verification checklist in `docs/DEPLOYMENT.md` before you describe the site as live.

Because the repository root is the site root, everything in the repository is published, so never commit secrets.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Page is blank or unstyled when opened from disk | Use `npm run dev`; modules do not load from `file://`. |
| `npm test` says unknown option or test not found | Use Node 20+. Check with `node --version`. |
| "Live email breach lookup is not configured yet." | You are on `hibp-server` without a valid `HIBP_API_KEY`. Use the free default or set the key. |
| "Unavailable: rate-limited" | The free API allows 25 lookups/hour and 100/day per IP. Wait for the retry hint. |
| Search says the provider "could not be reached" on static hosting | The `/api` routes need Node (`server/`) or Cloudflare Pages Functions (`functions/`). Plain static hosting cannot do lookups. |
| Contact page says "not configured" | Fill `contactEmail` / `repositoryUrl` in `js/config.js`. |

## Trademarks and independence

SEE UR DATA is an independent project with its own name, wording and visual design. It is not affiliated with, endorsed by or sponsored by Have I Been Pwned, XposedOrNot or any other breach service. Provider names appear only to attribute data and to explain research.

## Licence

No licence has been chosen. Without one, others have no automatic right to reuse the code. Add a `LICENSE` file (for example MIT) before publishing if you want others to be able to use it.
