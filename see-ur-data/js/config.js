// Site configuration. Contains NO secrets: everything in this file is public.
//
// provider:
//   "xposedornot-auto"  (default) FREE, no key. The browser asks XposedOrNot
//                   directly; only if it cannot, this site's /api/xon relay asks.
//   "xposedornot"       free, browser-direct only (needs the provider's CORS to allow it).
//   "xposedornot-relay" free, always via this site's server (all visitors share one
//                   provider allowance: 25/hour, 100/day; low volume only).
//   "hibp-server"       Have I Been Pwned via THIS site's server; needs a paid key held
//                   in the server-only HIBP_API_KEY variable. See docs/HIBP.md.
//   "none"              live checking off; no request is ever made.
//
// There is NO key in this file or anywhere in browser code. For hibp-server, test
// vs production mode is decided on the server (HIBP_MODE) and cannot be switched
// from the browser.
//
// contactEmail / repositoryUrl:
//   Left empty on purpose. Fill in your own real values before publishing.
//   The contact page shows an honest "not configured" message while empty.

export const config = Object.freeze({
  provider: "xposedornot-auto",
  contactEmail: "",
  repositoryUrl: "",
  clientLimits: Object.freeze({
    // In-memory only, resets on reload. Kept below the provider's documented
    // free-tier caps so one visitor does not exhaust their own allowance.
    perMinute: 5,
    perHour: 20,
  }),
});
