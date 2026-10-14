// Browser-side provider for the HIBP integration. The browser never contacts
// Have I Been Pwned and never holds a key: it calls this site's own server
// (POST /api/check), which holds the key and talks to HIBP.
//
// Anti-fabrication rules applied to the server's answer:
//  - "no match" requires HTTP 200 from our server AND upstreamStatus === 404,
//    i.e. the server reports that HIBP itself answered 404. Static hosts that
//    return their own 404 page for a missing /api route therefore never
//    produce a clean result: they produce "unavailable".
//  - "breach" requires upstreamStatus === 200 and well-formed breach records.
//  - Everything else is "unavailable", with distinct reasons.

import {
  confirmedBreach,
  noMatch,
  unavailable,
  makeBreach,
  UNAVAILABLE_REASON as R,
} from "../result-model.js";

export const HIBP_INFO = Object.freeze({ id: "hibp", name: "Have I Been Pwned", url: "https://haveibeenpwned.com" });

const ERROR_REASON = Object.freeze({
  rate_limited: R.RATE_LIMITED,
  rate_limited_local: R.RATE_LIMITED,
  authentication: R.AUTHENTICATION_ERROR,
  access_denied: R.ACCESS_DENIED,
  bad_request: R.BAD_REQUEST,
  server_error: R.SERVER_ERROR,
  timeout: R.TIMEOUT,
  network: R.NETWORK_ERROR,
  invalid_response: R.INVALID_RESPONSE,
  unexpected_status: R.PROVIDER_ERROR,
});

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Pure interpreter, exported for tests. Never throws; always returns a genuine result.
 * @param {number} httpStatus  HTTP status of OUR server's response
 * @param {unknown} body       parsed JSON envelope
 */
export function interpretEnvelope(httpStatus, body) {
  if (!isObj(body) || typeof body.state !== "string") return unavailable({ reason: R.INVALID_RESPONSE, provider: HIBP_INFO });
  const testMode = body.mode === "test";
  const modeOk = body.mode === "test" || body.mode === "production";

  switch (body.state) {
    case "not_configured":
      return unavailable({ reason: R.SERVER_NOT_CONFIGURED });

    case "invalid_input":
      return unavailable({ reason: R.BAD_REQUEST, testMode });

    case "not_found":
      if (httpStatus === 200 && body.upstreamStatus === 404 && modeOk) return noMatch({ provider: HIBP_INFO, testMode });
      return unavailable({ reason: R.INVALID_RESPONSE, provider: HIBP_INFO, testMode });

    case "breached": {
      if (httpStatus !== 200 || body.upstreamStatus !== 200 || !modeOk || !Array.isArray(body.breaches) || body.breaches.length === 0) {
        return unavailable({ reason: R.INVALID_RESPONSE, provider: HIBP_INFO, testMode });
      }
      let breaches;
      try {
        breaches = body.breaches.map((b) =>
          makeBreach({
            name: b?.title || b?.name,
            domain: b?.domain,
            description: b?.description,
            year: b?.year,
            records: b?.records,
            exposedData: b?.exposedData,
            category: b?.category,
            verified: b?.verified === true,
            passwordRisk: "unknown",
          }),
        );
      } catch {
        return unavailable({ reason: R.INVALID_RESPONSE, provider: HIBP_INFO, testMode });
      }
      if (breaches.some((b) => b.verified)) return confirmedBreach({ provider: HIBP_INFO, breaches, testMode });
      return unavailable({ reason: R.UNVERIFIED_MATCH, provider: HIBP_INFO, breaches, testMode });
    }

    case "error": {
      const reason = ERROR_REASON[body.errorKind] ?? R.PROVIDER_ERROR;
      return unavailable({
        reason,
        provider: HIBP_INFO,
        retryAfterSeconds: Number.isFinite(body.retryAfterSeconds) ? body.retryAfterSeconds : null,
        testMode,
      });
    }

    default:
      return unavailable({ reason: R.INVALID_RESPONSE, provider: HIBP_INFO });
  }
}

export function createHibpServerProvider({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  checkPath = "/api/check",
  statusPath = "/api/status",
  timeoutMs = 25_000,
} = {}) {
  const common = { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", redirect: "error" };

  return Object.freeze({
    id: HIBP_INFO.id,
    isConfigured: typeof fetchImpl === "function",
    info: HIBP_INFO,
    disclosure: "Each check sends the address you enter to this site's server, which asks Have I Been Pwned about it.",

    /** @returns {Promise<{state:"ready"|"not_configured", mode:"test"|"production"|null}|null>} null when the server cannot be reached */
    async status() {
      try {
        const res = await fetchImpl(statusPath, { method: "GET", ...common });
        const body = JSON.parse(await res.text());
        if (res.status === 200 && isObj(body) && (body.state === "ready" || body.state === "not_configured")) {
          return { state: body.state, mode: body.mode === "test" || body.mode === "production" ? body.mode : null };
        }
      } catch {
        /* fall through */
      }
      return null;
    },

    /** Never throws for network/server problems; returns an "unavailable" result instead. */
    async lookup(email, { signal } = {}) {
      const ac = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, timeoutMs);
      const onAbort = () => ac.abort();
      if (signal) {
        if (signal.aborted) ac.abort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        const res = await fetchImpl(checkPath, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ email }),
          signal: ac.signal,
          ...common,
        });
        let body;
        try {
          body = JSON.parse(await res.text());
        } catch {
          // Not JSON: e.g. a static host's HTML 404 for a missing /api route. Never a verdict.
          return unavailable({ reason: R.PROVIDER_ERROR, provider: HIBP_INFO });
        }
        return interpretEnvelope(res.status, body);
      } catch (err) {
        if (err && err.name === "AbortError") return unavailable({ reason: timedOut ? R.TIMEOUT : R.PROVIDER_ERROR, provider: HIBP_INFO });
        return unavailable({ reason: R.NETWORK_ERROR, provider: HIBP_INFO });
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
      }
    },
  });
}
