# Testing

## Run the tests

```bash
node --version      # needs Node 20 or newer
npm test            # runs every file in tests/ with Node's built-in test runner
npm run check       # verifies every local link in the HTML pages resolves
```

There are **no dependencies to install**. All tests use synthetic data only: addresses on reserved example domains (`synthetic.user@example.com`), HIBP's own test accounts, and invented breach records that exist solely as parser fixtures. `npm test` never contacts the real internet; its end-to-end tests talk to a **local stand-in** for HIBP on 127.0.0.1.

Last full run in the build environment: **109 tests, 109 passing**.

### Live checks against the real services (run these yourself)

```bash
npm run verify:free-api     # the default free provider: status, CORS verdict, parser verdict
```

Exit `0` = reached the API and understood its answer; `1` = reached it but did not understand the answer; `2` = inconclusive (unreachable). **Not yet observed passing:** from the build environment it exits 2 (`ENOTFOUND`). Keep your output.

### The controlled integration test (optional paid HIBP route)

```bash
npm run test:integration
```

Uses HIBP's documented test key and test accounts in **test mode** only, on the server side. Exit `0` = passed against the live service, `1` = reached HIBP but a check failed, `2` = inconclusive (HIBP unreachable). **It has not yet been observed passing:** from the build environment it exits 2 because `haveibeenpwned.com` cannot be resolved there. Run it on your own machine and keep the output. See `docs/HIBP.md`.

## What each requirement maps to

| Requirement from the brief | Test file | What is checked |
| --- | --- | --- |
| Valid and invalid email inputs | `tests/email.test.mjs` | Accepted forms and normalisation; 28 rejected inputs each with a specific error code; hostile strings (markup, query/path/fragment characters) are rejected. |
| Provider success and failure | `tests/hibp-server.test.mjs`, `tests/hibp-browser.test.mjs`, `tests/xposedornot.test.mjs` | Request shape (no key, no cookies, no referrer, no cache, encoded address); success mapping; HTTP 400/401/403/404/500/502/503; thrown network errors; timeout; caller cancellation; oversized body. |
| Confirmed breach and confirmed no-match | `tests/xposedornot.test.mjs`, `tests/copy.test.mjs` | Only the complete documented not-found shape becomes "no match". Mixed verified/unverified records. Unverified-only matches are *inconclusive*. Paste-only exposure is not called clean. |
| Rate limits and network errors | `tests/rate-gate.test.mjs`, `tests/no-fabrication.test.mjs`, `tests/xposedornot.test.mjs` | Minute and hour windows, retry timing, cooldown after HTTP 429, blocked attempts consume nothing, network errors leave no verdict. |
| Prevention of fabricated results | `tests/no-fabrication.test.mjs`, `tests/xposedornot.test.mjs` | Shipped config has no provider; unknown provider ids fall back to unconfigured; unconfigured provider makes no network call; constructors refuse verdicts without evidence; forged result objects are discarded by the controller; malformed bodies never become a verdict. |
| Privacy-sensitive logging | `tests/privacy.test.mjs` | No `console.*` in site code; runtime run of every outcome with all console methods spied (nothing is logged); no storage, cookies, beacons, analytics; no external hosts in pages, CSS or scripts (except the optional adapter); no API keys or auth headers; email input has no `name` so it cannot leak into a URL; strict CSP and security headers. |
| Wording accuracy | `tests/copy.test.mjs` | "No match" never claims safety; every "unavailable" reason has distinct copy and says it is not a result; provider text stays inert and the renderer uses no HTML-parsing APIs. |
| Mobile responsiveness and accessibility | `tests/a11y.test.mjs` | See below. |

### What `tests/a11y.test.mjs` verifies

These are **static checks**, fast and repeatable but only a proxy for a real browser audit:

- Colour contrast computed from the CSS tokens: body text AAA, secondary text and accents AA, button states, and 3:1 for input and button borders.
- Every page: `lang`, viewport that allows zoom, unique title, one `h1`, one `main`, landmarks, skip link first in tab order, correct `aria-current`.
- Unique ids, no dangling `aria-labelledby` / `aria-describedby` / `label for`, no skipped heading levels.
- Search form: labelled input, announced errors (`role="alert"`), named buttons, polite live results region, focus moved to the result heading, loading status.
- CSS: visible focus ring, reduced-motion support, forced-colors support, 44-48 px touch targets, mobile-first `min-width` queries only, table scroll container, no wide fixed widths.
- Colour is never the only signal: each state has a text label.

## What is NOT covered by automated tests

Be honest with yourself about these gaps. They need a person, a browser or the live service:

1. **A real browser.** Nothing here renders the page. Layout at phone widths, the focus ring's actual appearance and the animation are unverified until you look.
2. **Screen readers.** Announcement order and verbosity (NVDA, VoiceOver, TalkBack) were not tested.
3. **The real HIBP API.** Everything about HIBP is verified against its documentation and a local stand-in, not the live service, until you run `npm run test:integration` successfully. The optional XposedOrNot adapter is likewise untested live.
4. **Cloudflare headers.** `_headers` is validated as text, and the dev server replays it, but only the real deployment proves Cloudflare applies it.

## Manual test checklist (about 15 minutes)

Run it locally (`npm run dev`, open <http://localhost:8080>) and again on the deployed URL.

**Layout and responsiveness**
- [ ] In browser dev tools device mode, check widths 320, 375, 768, 1024 and 1440 px on all five pages. No horizontal scrolling, no clipped text, nav wraps cleanly.
- [ ] Zoom to 200% and 400%. Content reflows and remains usable.
- [ ] Rotate to landscape on a phone or emulator.
- [ ] The methodology table scrolls inside its box and not the page.

**Keyboard and focus**
- [ ] Press Tab once from page load: the "Skip to main content" link appears and works.
- [ ] Tab order follows the visual order and every control shows a clear focus ring.
- [ ] Submit with Enter inside the field. Focus lands on the result heading afterwards.
- [ ] Cancel and Clear work from the keyboard.

**States** (with the default `provider: "none"`)
- [ ] Empty submit: error appears under the field and is announced; focus returns to the field.
- [ ] `plainaddress`, `a@@b.com`, `user@localhost`: each gives a specific message.
- [ ] A valid synthetic address (for example `synthetic.user@example.com`): shows "Live breach checking is not available yet", states nothing was sent, and shows **no** breach or "no match" language.
- [ ] Open the browser's Network tab during the check: **no request** carrying the address appears.

**Privacy**
- [ ] Application tab: no cookies, no local/session storage, no IndexedDB entries for the site.
- [ ] Network tab on page load: every request is to your own origin. No fonts, analytics or images from elsewhere.
- [ ] Console: no output while using the site and no CSP violation reports.

**Automated audits** (optional but recommended)
- [ ] Chrome Lighthouse (Accessibility, Best Practices, SEO). Aim for 100 in Accessibility.
- [ ] The axe DevTools browser extension on each page: zero serious or critical issues.
- [ ] Reduced motion: enable "reduce motion" in your OS and confirm the page-load glow and loading pulse stop.
- [ ] Windows High Contrast / forced colours: borders stay visible.

**Only if you enable a provider** (see `docs/PROVIDERS.md`)
- [ ] Check an address you own that you know appears in a documented breach: breach cards appear with source attribution and links.
- [ ] Check a brand-new address you own that has never been used anywhere: you get either "No match" with its caveat, or "Unavailable". Both are acceptable. A breach card here would be a bug.
- [ ] Block the provider in dev tools (offline): "The breach-data provider could not be reached".
- [ ] Network tab shows the request has no cookies and no `Referer`.

## Adding tests

- Put new test files in `tests/` named `*.test.mjs`.
- Use only synthetic data. Never put real addresses or real breach records in the repository.
- Any new provider needs: a success case, a documented-not-found case, rate-limit and network-error cases, malformed-response cases, and a test showing it cannot produce a verdict from an ambiguous response.
