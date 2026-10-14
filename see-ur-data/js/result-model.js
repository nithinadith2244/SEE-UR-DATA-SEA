// Result model.
//
// Anti-fabrication design: every lookup outcome is created by one of the three
// constructors below. Each constructor validates its input and registers the
// frozen object in a module-private WeakSet. The controller only accepts
// objects that pass isGenuineResult(), so UI code (or a buggy provider) cannot
// hand-craft a "breach" or a "no match" and have it displayed.

import { sanitizeHttpsUrl } from "./url.js";

export const RESULT_KIND = Object.freeze({
  CONFIRMED_BREACH: "confirmed_breach",
  NO_MATCH: "no_match",
  UNAVAILABLE: "unavailable",
});

export const UNAVAILABLE_REASON = Object.freeze({
  PROVIDER_UNCONFIGURED: "provider_unconfigured",
  NETWORK_ERROR: "network_error",
  TIMEOUT: "timeout",
  RATE_LIMITED: "rate_limited",
  CLIENT_RATE_LIMITED: "client_rate_limited",
  INVALID_RESPONSE: "invalid_response",
  UNSUPPORTED_RESPONSE: "unsupported_response",
  PROVIDER_ERROR: "provider_error",
  UNVERIFIED_MATCH: "unverified_match",
  SERVER_NOT_CONFIGURED: "server_not_configured",
  AUTHENTICATION_ERROR: "authentication_error",
  ACCESS_DENIED: "access_denied",
  BAD_REQUEST: "bad_request",
  SERVER_ERROR: "server_error",
});

export const BREACH_CATEGORY = Object.freeze(["fabricated", "spam_list", "stealer_log", "malware"]);
export const PASSWORD_RISK = Object.freeze(["plaintext", "easy_to_crack", "hard_to_crack", "unknown"]);

const genuine = new WeakSet();

function isNonEmptyString(v, max = 500) {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

/** Validate and freeze a provider descriptor used for attribution. */
export function makeProviderInfo(info) {
  if (!info || !isNonEmptyString(info.id, 50) || !isNonEmptyString(info.name, 100)) {
    throw new TypeError("provider info needs an id and a name");
  }
  const url = sanitizeHttpsUrl(info.url);
  if (!url) throw new TypeError("provider info needs an https url for attribution");
  return Object.freeze({ id: info.id, name: info.name, url });
}

/** Validate and freeze a single breach record. Throws on anything malformed. */
export function makeBreach(b) {
  if (!b || typeof b !== "object") throw new TypeError("breach must be an object");
  if (!isNonEmptyString(b.name, 200)) throw new TypeError("breach needs a name");
  if (typeof b.verified !== "boolean") throw new TypeError("breach.verified must be boolean");
  const passwordRisk = PASSWORD_RISK.includes(b.passwordRisk) ? b.passwordRisk : "unknown";
  const year = typeof b.year === "string" && /^\d{4}$/.test(b.year) ? b.year : null;
  const records = Number.isSafeInteger(b.records) && b.records > 0 ? b.records : null;
  const exposedData = Array.isArray(b.exposedData)
    ? b.exposedData.filter((x) => isNonEmptyString(x, 100)).map((x) => x.trim()).slice(0, 50)
    : [];
  return Object.freeze({
    name: b.name.trim(),
    domain: isNonEmptyString(b.domain, 253) ? b.domain.trim() : null,
    industry: isNonEmptyString(b.industry, 100) ? b.industry.trim() : null,
    description: isNonEmptyString(b.description, 2000) ? b.description.trim() : null,
    year,
    records,
    exposedData: Object.freeze(exposedData),
    passwordRisk,
    category: BREACH_CATEGORY.includes(b.category) ? b.category : null,
    verified: b.verified,
    referenceUrl: sanitizeHttpsUrl(b.referenceUrl),
  });
}

function makeBreaches(list) {
  if (!Array.isArray(list) || list.length === 0) throw new TypeError("breaches must be a non-empty array");
  return Object.freeze(list.map(makeBreach));
}

/** A provider returned a documented match and at least one record is marked verified by the source. */
export function confirmedBreach({ provider, breaches, testMode = false }) {
  const info = makeProviderInfo(provider);
  const list = makeBreaches(breaches);
  if (!list.some((b) => b.verified)) {
    throw new TypeError("confirmedBreach needs at least one source-verified breach; use unavailable(UNVERIFIED_MATCH)");
  }
  const r = Object.freeze({ kind: RESULT_KIND.CONFIRMED_BREACH, provider: info, breaches: list, testMode: testMode === true });
  genuine.add(r);
  return r;
}

/** A provider returned its documented explicit "not found" response. Never means "safe". */
export function noMatch({ provider, testMode = false }) {
  const r = Object.freeze({ kind: RESULT_KIND.NO_MATCH, provider: makeProviderInfo(provider), testMode: testMode === true });
  genuine.add(r);
  return r;
}

/** Lookup could not produce a conclusive answer. */
export function unavailable({ reason, provider = null, breaches = null, retryAfterSeconds = null, testMode = false }) {
  if (!Object.values(UNAVAILABLE_REASON).includes(reason)) throw new TypeError("unknown unavailable reason");
  const retry =
    Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? Math.min(Math.ceil(retryAfterSeconds), 86400) : null;
  const r = Object.freeze({
    kind: RESULT_KIND.UNAVAILABLE,
    reason,
    provider: provider ? makeProviderInfo(provider) : null,
    breaches: breaches ? makeBreaches(breaches) : null,
    retryAfterSeconds: retry,
    testMode: testMode === true,
  });
  genuine.add(r);
  return r;
}

export function isGenuineResult(value) {
  return typeof value === "object" && value !== null && genuine.has(value);
}
