// Live check of the FREE XposedOrNot API, run from a machine with internet access:
//
//   npm run verify:free-api                         # uses a random synthetic address
//   npm run verify:free-api -- you@example.com      # or an address of your own to check
//
// It makes ONE request to https://api.xposedornot.com/v1/breach-analytics (it counts
// against your own free allowance: 25/hour, 100/day) and reports:
//   - the observed HTTP status and relevant headers (no secrets are involved: no key exists),
//   - whether the provider sends CORS headers that let a BROWSER on another origin read it
//     (decides whether the browser-direct route works or the /api/xon relay is needed),
//   - how this project's strict parser and provider classify the real answer.
// Exit codes: 0 = reached the API and the answer was understood, 1 = reached it but the answer
// was not understood, 2 = INCONCLUSIVE: could not reach it (nothing is claimed).

import { parseAnalyticsResponse, createXposedOrNotProvider, XON_BASE_URL } from "../js/providers/xposedornot.js";
import { validateEmail } from "../js/email.js";
import { randomBytes } from "node:crypto";

const out = (s = "") => process.stdout.write(`${s}\n`);
const arg = process.argv[2];
const email = arg ?? `see-ur-data-probe-${randomBytes(6).toString("hex")}@example.com`;
const v = validateEmail(email);
if (!v.ok) {
  out(`Not a valid address: ${v.message}`);
  process.exit(1);
}

const siteOrigin = "https://see-ur-data.pages.dev"; // stand-in for your deployed origin
out("SEE UR DATA - live check of the free XposedOrNot API");
out(`Address: ${arg ? "(the one you supplied)" : "random synthetic probe address"}   Browser origin simulated: ${siteOrigin}`);
out("");

let res;
let text;
try {
  res = await fetch(`${XON_BASE_URL}/v1/breach-analytics?email=${encodeURIComponent(v.email)}`, {
    headers: { accept: "application/json", origin: siteOrigin },
    redirect: "error",
  });
  text = await res.text();
} catch (err) {
  out(`Could not reach ${XON_BASE_URL}: ${err?.cause?.code ?? err?.name ?? "network error"}`);
  out("");
  out("RESULT: INCONCLUSIVE (exit 2). No HTTP status was observed, so nothing about the free API can be claimed.");
  process.exit(2);
}

const h = (n) => res.headers.get(n) ?? "(absent)";
out(`HTTP status                 : ${res.status}`);
out(`content-type                : ${h("content-type")}`);
out(`access-control-allow-origin : ${h("access-control-allow-origin")}`);
out(`retry-after                 : ${h("retry-after")}`);
const acao = res.headers.get("access-control-allow-origin");
const corsOk = acao === "*" || acao === siteOrigin;
out("");
out(corsOk
  ? "CORS: OK. A browser on another origin can read this API, so the browser-direct route works."
  : "CORS: NOT granted for a browser origin. The browser-direct route will fail; the site falls back to its /api/xon relay (shared allowance, low volume).");

let parsed = null;
try { parsed = parseAnalyticsResponse(JSON.parse(text)); } catch { /* not JSON */ }
out(`Strict parser classification : ${parsed ? parsed.type : "unreadable (not JSON)"}${parsed?.type === "found" ? ` (${parsed.breaches.length} breach record(s))` : ""}`);

const provider = createXposedOrNotProvider({});
const result = await provider.lookup(v.email);
out(`Provider result              : ${result.kind}${result.reason ? ` / ${result.reason}` : ""}`);
out("");

const understood = res.status === 200 && parsed && ["found", "none"].includes(parsed.type);
if (understood) out(`RESULT: PASSED (exit 0). Reached the live API (HTTP ${res.status}) and understood its answer. CORS for browsers: ${corsOk ? "yes" : "no (relay will be used)"}.`);
else out(`RESULT: FAILED (exit 1). Reached the API (HTTP ${res.status}) but its answer was not understood as a documented breach or not-found response. The site will show "unavailable" for this case, never a verdict.`);
process.exit(understood ? 0 : 1);
