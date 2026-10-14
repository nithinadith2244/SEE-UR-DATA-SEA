> **Update.** XposedOrNot's free API is now the **default provider** (`xposedornot-auto`: browser-direct first, same-origin relay as a network-failure fallback). The README of its open-source repository (read 14 Oct 2026) confirms: no key for `/v1/check-email`, `/v1/breach-analytics` and `/v1/breaches`; limits per IP of 25/hour and 100/day on the email endpoints; MIT-licensed code; and the free API is "for personal and low-volume use", with paid plans (from US$5/month there; earlier docs said US$9) for products. **Still unverified:** whether the API sends CORS headers for your origin. I searched and found nothing either way, so the code handles both cases, and `npm run verify:free-api` settles it on your machine. Have I Been Pwned remains an optional paid server-side route (`docs/HIBP.md`).

# Breach-data provider feasibility report

**Reviewed:** 9 October 2026 &nbsp;|&nbsp; **Question:** is there a legitimate, publicly accessible source that supports individual email-breach lookups, **without an API key or payment**, and permits this kind of use on a public website?

## Verdict

**No source was found that clearly satisfies every requirement**, so SEE UR DATA ships with live checking **off** (`provider: "none"` in `js/config.js`). In that state the site makes no network request about an address and shows an explicit "unavailable" message. It never substitutes mock results.

One candidate, **XposedOrNot's free API**, gets close. An adapter for it is included but disabled, because three requirements are unresolved (see "Open questions" below). Enabling it is a decision for the site operator after reading this page.

## What was checked, and how much to trust it

| Evidence level | Meaning |
| --- | --- |
| **Read at source** | The provider's own documentation or terms were opened and read during this review. |
| **Third-party description** | Only a package README, marketplace listing or similar was seen. Treat as unconfirmed. |
| **Not tested** | Behaviour that can only be learned by calling the live service. The build environment had no access to these hosts, so **no live call to any provider was made**. |

## Candidates

### 1. XposedOrNot free API (closest match)

| Requirement | Finding | Evidence |
| --- | --- | --- |
| Individual email search | **Yes.** `GET https://api.xposedornot.com/v1/check-email/{email}` (names only) and `GET /v1/breach-analytics?email={email}` (full details: breach name, description, domain, industry, password risk, references, exposed data types, year, record count, verified flag). | Read at source: `xposedornot.com/api_doc` |
| Authentication | **None** for email endpoints. Only the domain-monitoring endpoint needs a key. | Read at source |
| Rate limits (free tier, per IP, per endpoint) | 2 requests/second, **25/hour, 100/day** for `check-email` and `breach-analytics`. HTTP 429 when exceeded. | Read at source |
| Usage restrictions | The docs say the free API is "for personal and low-volume use" and that anyone "building a product on breach data" should use the paid plan. Terms require attribution, forbid circumventing limits, forbid bulk scraping and forbid reselling or redistributing the data without written authorisation. | Read at source: `api_doc`, `terms` (July 2026), FAQ |
| Commercial / public redistribution | **Not clearly permitted on the free tier.** A public website that lets many visitors query the free API is arguably "building a product". Written confirmation from the provider is advisable. Paid plans (xonAPI+, from US$9/month per its docs) exist but conflict with this project's no-paid-API rule. | Read at source |
| Data freshness and coverage | Self-reported "11.6 billion+ breach records"; the API quick reference was marked last updated 3 June 2026. No freshness guarantee is stated, and the terms say coverage is limited to what is publicly disclosed or received. **Not independently verified.** | Read at source (self-reported) |
| Browser access vs backend | **Unknown.** The documentation does not mention CORS, so it is not known whether a browser on another origin can call the API directly. A backend proxy would solve this but adds a server, and it would send every visitor's lookup from one IP, which hits the per-IP limits immediately and looks like the "rotating IPs / circumvention" the terms forbid. | **Not tested** |
| Privacy | The address travels in the URL query string. The terms say searches are processed in memory and not stored in an identifiable form. That is the provider's own statement and cannot be verified from here. | Read at source (provider's claim) |
| Branding | Terms forbid using the provider's name or branding in ways that imply affiliation. This project attributes the source by name and states it is not affiliated. | Read at source |

**Open questions before enabling it**

1. **Does the free tier allow a public site?** Ask the provider in writing (their terms list a contact address) or move to a paid plan.
2. **Does the API send CORS headers** allowing your site's origin? Test from your deployed origin (steps in `docs/DEPLOYMENT.md`).
3. **Does the live "not found" response match the documented shape?** The adapter accepts only the documented all-null response as "no match". If the live API differs, the adapter reports "unavailable" instead, which fails safe.

### 2. Have I Been Pwned: email breach lookup

- **Individual email search:** yes, through its `breachedaccount` API.
- **Authentication:** requires an `hibp-api-key` header. **Confirmed from HIBP's own documentation** (<https://haveibeenpwned.com/API/v3>), which also says keyed endpoints do not support CORS and must be proxied through your own server. A documented test key works only for `@hibp-integration-tests.com` addresses.
- **Evidence level:** *read at source*. Now used server-side, see `docs/HIBP.md`.

### 3. Have I Been Pwned: Pwned Passwords range API

- Free and keyless, using k-anonymity, but it checks **passwords, not email addresses**. It does not provide email-breach lookup and is **not used**, as the project brief requires.
- **Evidence level:** *third-party description*.

### 4. "hackmyip" breach endpoint

- A package README claims a free email breach check with no key.
- **Not adopted.** Only the README was seen: no terms of use, data source, coverage, freshness, rate limits or privacy statement were reviewed, so it cannot be called legitimate or accurate. Evidence level: *third-party description*.

### 5. Marketplace wrappers (for example an Apify actor around HIBP)

- Resell access to the provider above. They need that provider's key and charge per item, so they fail the no-key, no-payment rule.

## Why a mock or a bundled dataset is not the answer

- A mock would violate the brief ("never invent breach records").
- Shipping a downloaded breach corpus inside a static site would mean redistributing personal data and would almost certainly breach the original terms. It is out of scope.

## What the code does about all this

| Situation | Behaviour |
| --- | --- |
| `provider: "none"` (default) | No request is made. Result: *Unavailable* ("Live breach checking is not available yet"). |
| `provider: "xposedornot"` | Calls `/v1/breach-analytics` directly from the browser. Strict parser. Anything unexpected is *Unavailable*. A 404 is **not** treated as "no match". |
| Provider origin not in the CSP | The browser blocks the request and the page shows *Unavailable* (network error). |
| Any other provider | Add a file in `js/providers/` that returns results only through `js/result-model.js`, register it in `js/providers/index.js`, and add its tests. |

## How to enable the XposedOrNot adapter (only after resolving the open questions)

1. In `js/config.js` set `provider: "xposedornot"`.
2. In `_headers`, change `connect-src 'self'` to `connect-src 'self' https://api.xposedornot.com`.
3. Re-run `npm test`. The privacy test that asserts a closed `connect-src` will fail by design: edit that assertion to expect the single added origin, so the change is a deliberate, reviewed one.
4. Update the Privacy and Methodology pages if your deployment's behaviour differs.
5. Follow the live verification steps in `docs/DEPLOYMENT.md` using an address you own.

Do **not** put any provider API key in this repository or in the browser. If you later move to a paid provider, call it from a server you control and keep the key there.

## Sources consulted

- XposedOrNot API documentation: <https://xposedornot.com/api_doc>
- XposedOrNot terms and conditions (last updated July 2026): <https://xposedornot.com/terms>
- XposedOrNot FAQ: <https://xposedornot.com/faq>
- Official XposedOrNot SDK READMEs (PyPI, docs.rs, pkg.go.dev), used only to cross-check rate limits and the free/paid split
- Marketplace listing describing HIBP key requirements and Pwned Passwords k-anonymity (third-party)
- The `hackmyip` package README (third-party)

Provider terms change. Re-check them before you enable any provider and again from time to time.
