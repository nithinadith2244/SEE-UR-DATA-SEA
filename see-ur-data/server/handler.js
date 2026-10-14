// Platform-neutral request handlers used by both the Node server
// (server/app-server.mjs) and the Cloudflare Pages Functions (functions/api/*).
//
// Rules enforced here:
//  - The API key is read from the server environment only and never appears in a
//    response, a log line or an error message. This file does not log at all.
//  - "not_found" is produced only from a genuine upstream HTTP 404.
//  - Test mode answers only for hibp-integration-tests.com addresses; production
//    mode refuses them. Test data can therefore never be shown for a real address.
//  - Nothing is stored. Email addresses are never logged or retained.

import { validateEmail } from "../js/email.js";
import {
  HIBP_BASE_URL,
  HIBP_SOURCE,
  HIBP_TEST_DOMAIN,
  NOT_CONFIGURED_MESSAGE,
  emailDomain,
  queryBreachedAccount,
  resolveConfig,
} from "./hibp.js";
import { createIpLimiter } from "./limiter.js";

const MAX_BODY_BYTES = 1024;

export function jsonResponse(status, body, extraHeaders = {}) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

const HTTP_FOR_ERROR = Object.freeze({
  rate_limited: 429,
  timeout: 504,
  authentication: 502,
  access_denied: 502,
  bad_request: 502,
  server_error: 502,
  network: 502,
  invalid_response: 502,
  unexpected_status: 502,
});

/**
 * Shared request checks for every lookup route: method, same-origin, media type,
 * size, JSON and email validation. Returns {response} to send, or {email}.
 */
export function precheck(req) {
  if (req.method !== "POST") {
    return { response: jsonResponse(405, { state: "error", errorKind: "method_not_allowed" }, { allow: "POST" }) };
  }
  // Block other websites from spending this deployment's quota via a visitor's browser.
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try {
      ok = new URL(origin).host === req.headers.host;
    } catch {
      ok = false;
    }
    if (!ok) return { response: jsonResponse(403, { state: "error", errorKind: "forbidden_origin" }) };
  }
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
    return { response: jsonResponse(415, { state: "error", errorKind: "unsupported_media_type" }) };
  }
  if (typeof req.bodyText !== "string" || new TextEncoder().encode(req.bodyText).length > MAX_BODY_BYTES) {
    return { response: jsonResponse(413, { state: "error", errorKind: "payload_too_large" }) };
  }
  let payload;
  try {
    payload = JSON.parse(req.bodyText);
  } catch {
    return { response: jsonResponse(400, { state: "invalid_input", code: "bad_json", message: "The request body must be JSON." }) };
  }
  const v = validateEmail(payload && typeof payload === "object" ? payload.email : undefined);
  if (!v.ok) return { response: jsonResponse(400, { state: "invalid_input", code: v.code, message: v.message }) };
  return { email: v.email };
}

/**
 * @param {{method:string, headers:Record<string,string>, bodyText:string, ip:string}} req  (header names lower-case)
 * @param {{env:Record<string,string|undefined>, fetchImpl?:Function, baseUrl?:string, limiter:{check:Function}, userAgent?:string, timeoutMs?:number}} ctx
 */
export async function handleCheck(req, ctx) {
  const pre = precheck(req);
  if (pre.response) return pre.response;
  const v = { ok: true, email: pre.email };

  const cfg = resolveConfig(ctx.env);
  if (cfg.state !== "ready") {
    return jsonResponse(503, { state: "not_configured", message: NOT_CONFIGURED_MESSAGE, upstreamStatus: null });
  }

  const isTestAddress = emailDomain(v.email) === HIBP_TEST_DOMAIN;
  if (cfg.mode === "test" && !isTestAddress) {
    return jsonResponse(400, {
      state: "invalid_input",
      code: "test_mode_domain_only",
      mode: "test",
      message: `Test mode only accepts addresses on ${HIBP_TEST_DOMAIN}.`,
    });
  }
  if (cfg.mode === "production" && isTestAddress) {
    return jsonResponse(400, {
      state: "invalid_input",
      code: "test_domain_reserved",
      mode: "production",
      message: `Addresses on ${HIBP_TEST_DOMAIN} are reserved for test mode.`,
    });
  }

  const slot = ctx.limiter.check(req.ip || "unknown");
  if (!slot.allowed) {
    return jsonResponse(
      429,
      { state: "error", errorKind: "rate_limited_local", mode: cfg.mode, retryAfterSeconds: slot.retryAfterSeconds, upstreamStatus: null },
      { "retry-after": String(slot.retryAfterSeconds) },
    );
  }

  const { upstreamStatus, outcome } = await queryBreachedAccount({
    email: v.email,
    apiKey: cfg.apiKey,
    baseUrl: ctx.baseUrl ?? HIBP_BASE_URL,
    fetchImpl: ctx.fetchImpl ?? globalThis.fetch,
    userAgent: ctx.userAgent,
    timeoutMs: ctx.timeoutMs,
  });

  const envelope = { ...outcome, mode: cfg.mode, upstreamStatus, source: HIBP_SOURCE };
  if (outcome.state === "breached" || outcome.state === "not_found") return jsonResponse(200, envelope);

  const extra = outcome.errorKind === "rate_limited" && outcome.retryAfterSeconds ? { "retry-after": String(outcome.retryAfterSeconds) } : {};
  return jsonResponse(HTTP_FOR_ERROR[outcome.errorKind] ?? 502, envelope, extra);
}

export function handleStatus(req, ctx) {
  if (req.method !== "GET") return jsonResponse(405, { state: "error", errorKind: "method_not_allowed" }, { allow: "GET" });
  const cfg = resolveConfig(ctx.env);
  if (cfg.state !== "ready") return jsonResponse(200, { state: "not_configured", message: NOT_CONFIGURED_MESSAGE, mode: null });
  return jsonResponse(200, { state: "ready", mode: cfg.mode });
}

export function createContext(overrides = {}) {
  // globalLimiter caps the shared-IP relay at 20/hour (provider free tier: 25/hour per IP).
  return { limiter: createIpLimiter(), globalLimiter: createIpLimiter({ limit: 20, windowMs: 3_600_000 }), ...overrides };
}
