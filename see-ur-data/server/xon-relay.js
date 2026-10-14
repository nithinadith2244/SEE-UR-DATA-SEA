// Same-origin relay for the free, keyless XposedOrNot API (POST /api/xon).
//
// Why it exists: the browser calls XposedOrNot directly first (each visitor then
// has their own per-IP allowance). If the browser cannot (CORS or network), it
// falls back here. The relay forwards the lookup from THIS server's IP, so every
// relayed visitor shares ONE allowance (documented free tier: 25/hour,
// 100/day per IP). A global cap therefore applies, and the relay answers 429
// with Retry-After instead of hammering the provider. Treat it as a low-volume
// fallback, not a way around the provider's limits.
//
// It relays the provider's answer for 200 and 429 only; any other upstream
// status becomes a 502, which the browser reports as an error and never as a
// clean result. It stores and logs nothing and never reads any key.

import { jsonResponse, precheck } from "./handler.js";

export const XON_API_BASE = "https://api.xposedornot.com";
const MAX_BODY_CHARS = 2_000_000;

/**
 * @param {object} req  same shape as handleCheck
 * @param {{env:object, fetchImpl?:Function, xonBaseUrl?:string, limiter:{check:Function}, globalLimiter:{check:Function}, userAgent?:string, timeoutMs?:number}} ctx
 */
export async function handleXonRelay(req, ctx) {
  if (String(ctx.env?.XON_RELAY ?? "on").trim().toLowerCase() === "off") {
    return jsonResponse(404, { state: "error", errorKind: "relay_disabled" });
  }
  const pre = precheck(req);
  if (pre.response) return pre.response;

  const mine = ctx.limiter.check(req.ip || "unknown");
  if (!mine.allowed) {
    return jsonResponse(429, { state: "error", errorKind: "rate_limited_local", retryAfterSeconds: mine.retryAfterSeconds }, { "retry-after": String(mine.retryAfterSeconds) });
  }
  const shared = ctx.globalLimiter.check("relay-global");
  if (!shared.allowed) {
    return jsonResponse(429, { state: "error", errorKind: "rate_limited_local", retryAfterSeconds: shared.retryAfterSeconds }, { "retry-after": String(shared.retryAfterSeconds) });
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ctx.timeoutMs ?? 15_000);
  try {
    const url = `${ctx.xonBaseUrl ?? XON_API_BASE}/v1/breach-analytics?email=${encodeURIComponent(pre.email)}`;
    const res = await (ctx.fetchImpl ?? globalThis.fetch)(url, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": ctx.userAgent ?? "SEE-UR-DATA-breach-checker" },
      redirect: "error",
      cache: "no-store",
      signal: ac.signal,
    });

    if (res.status === 429) {
      const n = Number(res.headers?.get?.("retry-after"));
      const retry = Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
      return jsonResponse(429, { state: "error", errorKind: "rate_limited", retryAfterSeconds: retry }, retry ? { "retry-after": String(retry) } : {});
    }
    if (res.status !== 200) {
      return jsonResponse(502, { state: "error", errorKind: "provider_error", upstreamStatus: res.status });
    }
    const text = await res.text();
    if (typeof text !== "string" || text.length > MAX_BODY_CHARS) {
      return jsonResponse(502, { state: "error", errorKind: "invalid_response", upstreamStatus: 200 });
    }
    // Verbatim body: the browser applies the same strict parser it uses for direct calls.
    return { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }, body: text };
  } catch {
    return jsonResponse(502, { state: "error", errorKind: "network" });
  } finally {
    clearTimeout(timer);
  }
}
