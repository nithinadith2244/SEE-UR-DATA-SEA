// XposedOrNot adapter (OPTIONAL, disabled by default; see docs/PROVIDERS.md).
//
// Built against the response shapes documented at https://xposedornot.com/api_doc
// (endpoint: GET /v1/breach-analytics?email=...). Written WITHOUT live access to
// the API, so the parser is deliberately strict: anything that does not match a
// documented shape becomes "unavailable", never "no match" and never "breach".
//
// Privacy notes (also in the Privacy page): the address is sent to the provider
// in the URL query string. Requests omit cookies, the Referer header and any
// cache, and no API key is used or required.

import { validateEmail } from "../email.js";
import {
  confirmedBreach,
  noMatch,
  unavailable,
  makeBreach,
  UNAVAILABLE_REASON as R,
} from "../result-model.js";

export const XON_INFO = Object.freeze({
  id: "xposedornot",
  name: "XposedOrNot",
  url: "https://xposedornot.com",
});
export const XON_BASE_URL = "https://api.xposedornot.com";
const MAX_BODY_CHARS = 2_000_000;
const DEFAULT_TIMEOUT_MS = 15_000;

const RISK_MAP = Object.freeze({
  plaintext: "plaintext",
  easytocrack: "easy_to_crack",
  hardtocrack: "hard_to_crack",
  unknown: "unknown",
});

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function mapBreach(d) {
  if (!isObj(d)) return null;
  const year =
    typeof d.xposed_date === "string"
      ? d.xposed_date.trim()
      : Number.isInteger(d.xposed_date)
        ? String(d.xposed_date)
        : null;
  return makeBreach({
    name: d.breach,
    domain: d.domain,
    industry: d.industry,
    description: d.details,
    year,
    records: typeof d.xposed_records === "number" ? d.xposed_records : null,
    exposedData: typeof d.xposed_data === "string" ? d.xposed_data.split(";").map((s) => s.trim()) : [],
    passwordRisk: RISK_MAP[String(d.password_risk ?? "").toLowerCase()] ?? "unknown",
    // Only the literal "Yes" counts as verified by the source.
    verified: d.verified === "Yes",
    referenceUrl: d.references,
  });
}

/**
 * Pure parser, exported for tests.
 * @returns {{type:"found",breaches:object[]}|{type:"none"}|{type:"unsupported"}|{type:"invalid"}}
 */
export function parseAnalyticsResponse(body) {
  if (!isObj(body)) return { type: "invalid" };
  const eb = body.ExposedBreaches;

  if (eb === null) {
    const metricsNull = body.BreachMetrics === null;
    const summaryEmpty = isObj(body.BreachesSummary) && body.BreachesSummary.site === "";
    const pastesNull = body.ExposedPastes === null && body.PasteMetrics === null;
    const pasteCountZero = isObj(body.PastesSummary) && body.PastesSummary.cnt === 0;
    if (metricsNull && summaryEmpty && pastesNull && pasteCountZero) return { type: "none" };
    // Nothing in the breach list but real paste data present: we do not model
    // pastes, so we must not call this a clean result. A malformed paste block
    // is simply invalid.
    const pasteSummaryOk = isObj(body.PastesSummary) && Number.isInteger(body.PastesSummary.cnt);
    const pastesPresent = body.ExposedPastes !== null || (pasteSummaryOk && body.PastesSummary.cnt > 0);
    if (metricsNull && summaryEmpty && pasteSummaryOk && pastesPresent) return { type: "unsupported" };
    return { type: "invalid" };
  }

  if (!isObj(eb) || !Array.isArray(eb.breaches_details) || eb.breaches_details.length === 0) {
    return { type: "invalid" };
  }
  try {
    const breaches = eb.breaches_details.map((d) => {
      const b = mapBreach(d);
      if (!b) throw new TypeError("bad breach");
      return b;
    });
    return { type: "found", breaches };
  } catch {
    return { type: "invalid" };
  }
}

function parseRetryAfter(res) {
  const raw = res?.headers?.get?.("retry-after");
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function createXposedOrNotProvider({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  mode = "direct", // "direct": browser -> XposedOrNot (per-visitor allowance); "relay": browser -> this site's /api/xon
  relayPath = "/api/xon",
  baseUrl = XON_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  setTimeoutImpl = globalThis.setTimeout.bind(globalThis),
  clearTimeoutImpl = globalThis.clearTimeout.bind(globalThis),
} = {}) {
  return Object.freeze({
    id: XON_INFO.id,
    isConfigured: typeof fetchImpl === "function",
    info: XON_INFO,
    disclosure:
      mode === "relay"
        ? "Each check sends the address you enter to this site's server, which asks XposedOrNot about it."
        : "Each check sends the address you enter from your browser to XposedOrNot, a free breach-lookup service.",

    /** Never throws for network/provider problems; returns an "unavailable" result instead. */
    async lookup(email, { signal } = {}) {
      const v = validateEmail(email);
      if (!v.ok || v.email !== email) throw new TypeError("lookup() requires a validated, normalised email");
      if (typeof fetchImpl !== "function") return unavailable({ reason: R.PROVIDER_UNCONFIGURED });

      const ac = new AbortController();
      let timedOut = false;
      const timer = setTimeoutImpl(() => {
        timedOut = true;
        ac.abort();
      }, timeoutMs);
      const onOuterAbort = () => ac.abort();
      if (signal) {
        if (signal.aborted) ac.abort();
        else signal.addEventListener("abort", onOuterAbort, { once: true });
      }

      try {
        const res =
          mode === "relay"
            ? await fetchImpl(relayPath, {
                method: "POST",
                mode: "same-origin",
                credentials: "omit",
                cache: "no-store",
                redirect: "error",
                referrerPolicy: "no-referrer",
                headers: { "content-type": "application/json", accept: "application/json" },
                body: JSON.stringify({ email: v.email }),
                signal: ac.signal,
              })
            : await fetchImpl(`${baseUrl}/v1/breach-analytics?email=${encodeURIComponent(v.email)}`, {
                method: "GET",
                mode: "cors",
                credentials: "omit",
                cache: "no-store",
                redirect: "error",
                referrerPolicy: "no-referrer",
                headers: { Accept: "application/json" },
                signal: ac.signal,
              });

        if (res.status === 429) {
          return unavailable({
            reason: R.RATE_LIMITED,
            provider: XON_INFO,
            retryAfterSeconds: parseRetryAfter(res),
          });
        }
        // A 404 is NOT treated as "no match": the provider's docs describe the
        // documented not-found shape as an HTTP 200 body, and 404 is also
        // listed as an input error. Ambiguity resolves to "unavailable".
        if (!res.ok) return unavailable({ reason: R.PROVIDER_ERROR, provider: XON_INFO });

        const text = await res.text();
        if (typeof text !== "string" || text.length > MAX_BODY_CHARS) {
          return unavailable({ reason: R.INVALID_RESPONSE, provider: XON_INFO });
        }
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          return unavailable({ reason: R.INVALID_RESPONSE, provider: XON_INFO });
        }

        const parsed = parseAnalyticsResponse(body);
        switch (parsed.type) {
          case "none":
            return noMatch({ provider: XON_INFO });
          case "found":
            if (parsed.breaches.some((b) => b.verified)) {
              return confirmedBreach({ provider: XON_INFO, breaches: parsed.breaches });
            }
            return unavailable({ reason: R.UNVERIFIED_MATCH, provider: XON_INFO, breaches: parsed.breaches });
          case "unsupported":
            return unavailable({ reason: R.UNSUPPORTED_RESPONSE, provider: XON_INFO });
          default:
            return unavailable({ reason: R.INVALID_RESPONSE, provider: XON_INFO });
        }
      } catch (err) {
        if (err && err.name === "AbortError") {
          return unavailable({ reason: timedOut ? R.TIMEOUT : R.PROVIDER_ERROR, provider: XON_INFO });
        }
        // fetch() rejects with TypeError for network failures, blocked CORS and CSP refusals.
        return unavailable({ reason: R.NETWORK_ERROR, provider: XON_INFO });
      } finally {
        clearTimeoutImpl(timer);
        if (signal) signal.removeEventListener("abort", onOuterAbort);
      }
    },
  });
}
