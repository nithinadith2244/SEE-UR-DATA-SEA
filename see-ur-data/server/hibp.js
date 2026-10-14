// Server-side Have I Been Pwned client. This file must never be imported by
// browser code: it handles the API key.
//
// Documented behaviour (https://haveibeenpwned.com/API/v3):
//   GET /breachedaccount/{email}  header: hibp-api-key  (user-agent REQUIRED)
//   200 found | 400 bad request | 401 bad/missing key | 403 forbidden (missing
//   user agent or no access) | 404 not found | 429 rate limited (retry-after)
//   | 503 unavailable. Keyed endpoints do not support CORS, so a backend is required.
//   Test key 00000000000000000000000000000000 only works for addresses on
//   hibp-integration-tests.com.

export const HIBP_BASE_URL = "https://haveibeenpwned.com/api/v3";
export const HIBP_TEST_API_KEY = "00000000000000000000000000000000";
export const HIBP_TEST_DOMAIN = "hibp-integration-tests.com";
export const HIBP_SOURCE = Object.freeze({ name: "Have I Been Pwned", url: "https://haveibeenpwned.com" });
export const NOT_CONFIGURED_MESSAGE = "Live email breach lookup is not configured yet.";
export const DEFAULT_USER_AGENT = "SEE-UR-DATA-breach-checker";

const KEY_RE = /^[0-9a-f]{32}$/i;

/**
 * Decides which mode the server runs in. Test mode and production mode are
 * mutually exclusive and can never share a key:
 *  - production (default): needs a valid HIBP_API_KEY; the documented test key is rejected.
 *  - test: HIBP_MODE=test. Uses ONLY the documented test key, and refuses to start
 *    if HIBP_API_KEY is also set, so a real key can never be used (or leaked) by test mode.
 * @returns {{state:"ready",mode:"test"|"production",apiKey:string}|{state:"not_configured",reason:string}}
 */
export function resolveConfig(env = {}) {
  const mode = String(env.HIBP_MODE ?? "production").trim().toLowerCase();
  const rawKey = String(env.HIBP_API_KEY ?? "").trim();

  if (mode === "test") {
    if (rawKey !== "") return { state: "not_configured", reason: "conflicting_config" };
    return { state: "ready", mode: "test", apiKey: HIBP_TEST_API_KEY };
  }
  if (mode !== "production") return { state: "not_configured", reason: "unknown_mode" };

  if (rawKey === "") return { state: "not_configured", reason: "missing_key" };
  if (!KEY_RE.test(rawKey)) return { state: "not_configured", reason: "malformed_key" };
  if (rawKey === HIBP_TEST_API_KEY) return { state: "not_configured", reason: "test_key_in_production" };
  return { state: "ready", mode: "production", apiKey: rawKey };
}

export function emailDomain(email) {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

function htmlToText(html) {
  return String(html)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Strictly maps one documented breach-model object. Returns null if unusable. */
export function normaliseBreach(raw) {
  if (!isObj(raw) || typeof raw.Name !== "string" || raw.Name.trim() === "") return null;
  if (typeof raw.IsVerified !== "boolean") return null; // full model requested; verification status must be explicit
  const fabricated = raw.IsFabricated === true;
  const category = fabricated
    ? "fabricated"
    : raw.IsSpamList === true
      ? "spam_list"
      : raw.IsStealerLog === true
        ? "stealer_log"
        : raw.IsMalware === true
          ? "malware"
          : null;
  const date = typeof raw.BreachDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.BreachDate) ? raw.BreachDate : null;
  return {
    name: raw.Name.trim(),
    title: typeof raw.Title === "string" && raw.Title.trim() ? raw.Title.trim() : raw.Name.trim(),
    domain: typeof raw.Domain === "string" && raw.Domain.trim() ? raw.Domain.trim() : null,
    year: date ? date.slice(0, 4) : null,
    records: Number.isSafeInteger(raw.PwnCount) && raw.PwnCount > 0 ? raw.PwnCount : null,
    description: typeof raw.Description === "string" && raw.Description.trim() ? htmlToText(raw.Description).slice(0, 2000) : null,
    exposedData: Array.isArray(raw.DataClasses) ? raw.DataClasses.filter((x) => typeof x === "string" && x.trim()).slice(0, 50) : [],
    // A fabricated breach is never presented as verified.
    verified: raw.IsVerified === true && !fabricated,
    category,
  };
}

/**
 * Pure classifier for an upstream HTTP response. This is the single place that
 * decides what an HTTP status means.
 *
 *  "not_found" is returned ONLY for a genuine HTTP 404 that is not an HTML error page.
 *  Every other non-success status is its own, distinct error kind.
 *
 * @param {{status:number, contentType?:string|null, bodyText?:string, retryAfter?:string|null}} r
 */
export function classifyResponse({ status, contentType = null, bodyText = "", retryAfter = null }) {
  const isHtml = /text\/html/i.test(contentType ?? "") || /^\s*<(!doctype|html)/i.test(bodyText);

  if (status === 200) {
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return { state: "error", errorKind: "invalid_response" };
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return { state: "error", errorKind: "invalid_response" };
    const breaches = parsed.map(normaliseBreach);
    if (breaches.some((b) => b === null)) return { state: "error", errorKind: "invalid_response" };
    return { state: "breached", breaches };
  }
  if (status === 404) {
    if (isHtml) return { state: "error", errorKind: "unexpected_status" }; // a web/CDN error page is not the API's answer
    return { state: "not_found" };
  }
  if (status === 400) return { state: "error", errorKind: "bad_request" };
  if (status === 401) return { state: "error", errorKind: "authentication" };
  if (status === 403) return { state: "error", errorKind: "access_denied" };
  if (status === 429) {
    const n = Number(retryAfter);
    return { state: "error", errorKind: "rate_limited", retryAfterSeconds: Number.isFinite(n) && n > 0 ? Math.ceil(n) : null };
  }
  if (status >= 500 && status <= 599) return { state: "error", errorKind: "server_error" };
  return { state: "error", errorKind: "unexpected_status" };
}

/**
 * Performs the upstream request. Never throws for network problems.
 * @returns {Promise<{upstreamStatus:number|null, outcome:object}>}
 */
export async function queryBreachedAccount({
  email,
  apiKey,
  baseUrl = HIBP_BASE_URL,
  fetchImpl = globalThis.fetch,
  userAgent = DEFAULT_USER_AGENT,
  timeoutMs = 15_000,
}) {
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, timeoutMs);
  try {
    const url = `${baseUrl}/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`;
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { "hibp-api-key": apiKey, "user-agent": userAgent, accept: "application/json" },
      redirect: "error", // never forward the key to a redirect target
      cache: "no-store",
      signal: ac.signal,
    });
    const text = await res.text();
    return {
      upstreamStatus: res.status,
      outcome: classifyResponse({
        status: res.status,
        contentType: res.headers?.get?.("content-type") ?? null,
        bodyText: text.length > 5_000_000 ? "" : text,
        retryAfter: res.headers?.get?.("retry-after") ?? null,
      }),
    };
  } catch (err) {
    const kind = err && err.name === "AbortError" && timedOut ? "timeout" : "network";
    return { upstreamStatus: null, outcome: { state: "error", errorKind: kind } };
  } finally {
    clearTimeout(timer);
  }
}
