import test from "node:test";
import assert from "node:assert/strict";
import { createXposedOrNotProvider, parseAnalyticsResponse } from "../js/providers/xposedornot.js";
import { RESULT_KIND, UNAVAILABLE_REASON as R } from "../js/result-model.js";
import { SYNTHETIC_EMAIL, jsonResponse, fakeFetch, breachDetail, foundBody, notFoundBody } from "./helpers.mjs";

const mk = (responder, extra = {}) => {
  const f = fakeFetch(responder);
  return { provider: createXposedOrNotProvider({ fetchImpl: f, ...extra }), f };
};

test("confirmed breach: maps documented fields and attributes the source", async () => {
  const { provider, f } = mk(() => jsonResponse(foundBody()));
  const r = await provider.lookup(SYNTHETIC_EMAIL);
  assert.equal(r.kind, RESULT_KIND.CONFIRMED_BREACH);
  assert.equal(r.provider.name, "XposedOrNot");
  assert.equal(r.provider.url, "https://xposedornot.com/");
  const [b] = r.breaches;
  assert.equal(b.name, "ExampleBreach");
  assert.equal(b.year, "2015");
  assert.equal(b.records, 254967);
  assert.deepEqual([...b.exposedData], ["Email addresses", "Passwords", "Usernames"]);
  assert.equal(b.passwordRisk, "hard_to_crack");
  assert.equal(b.verified, true);
  assert.equal(b.referenceUrl, "https://example.com/report");
  assert.equal(f.calls.length, 1);
});

test("request shape: no key, no cookies, no referrer, no cache, encoded address", async () => {
  const { provider, f } = mk(() => jsonResponse(notFoundBody()));
  await provider.lookup("a+b@example.com");
  const { url, init } = f.calls[0];
  assert.equal(url, "https://api.xposedornot.com/v1/breach-analytics?email=a%2Bb%40example.com");
  assert.equal(init.method, "GET");
  assert.equal(init.credentials, "omit");
  assert.equal(init.cache, "no-store");
  assert.equal(init.referrerPolicy, "no-referrer");
  assert.equal(init.redirect, "error");
  assert.deepEqual(Object.keys(init.headers), ["Accept"]);
  assert.ok(!JSON.stringify(init).toLowerCase().includes("key"));
});

test("confirmed no-match: only the complete documented not-found shape qualifies", async () => {
  const { provider } = mk(() => jsonResponse(notFoundBody()));
  const r = await provider.lookup(SYNTHETIC_EMAIL);
  assert.equal(r.kind, RESULT_KIND.NO_MATCH);
  assert.equal(r.provider.name, "XposedOrNot");
});

test("rate limit (HTTP 429) is unavailable, carries Retry-After, never a verdict", async () => {
  const { provider } = mk(() => jsonResponse({}, { status: 429, headers: { "Retry-After": "30" } }));
  const r = await provider.lookup(SYNTHETIC_EMAIL);
  assert.equal(r.kind, RESULT_KIND.UNAVAILABLE);
  assert.equal(r.reason, R.RATE_LIMITED);
  assert.equal(r.retryAfterSeconds, 30);
});

test("rate limit without Retry-After still unavailable", async () => {
  const { provider } = mk(() => jsonResponse("", { status: 429 }));
  const r = await provider.lookup(SYNTHETIC_EMAIL);
  assert.equal(r.reason, R.RATE_LIMITED);
  assert.equal(r.retryAfterSeconds, null);
});

test("HTTP errors, including 404, are never treated as 'no match'", async () => {
  for (const status of [400, 401, 403, 404, 500, 502, 503]) {
    const { provider } = mk(() => jsonResponse({ Error: "Not found", email: null }, { status }));
    const r = await provider.lookup(SYNTHETIC_EMAIL);
    assert.equal(r.kind, RESULT_KIND.UNAVAILABLE, String(status));
    assert.equal(r.reason, R.PROVIDER_ERROR, String(status));
  }
});

test("network error (fetch rejects) is unavailable/network_error", async () => {
  const { provider } = mk(() => {
    throw new TypeError("Failed to fetch");
  });
  const r = await provider.lookup(SYNTHETIC_EMAIL);
  assert.equal(r.kind, RESULT_KIND.UNAVAILABLE);
  assert.equal(r.reason, R.NETWORK_ERROR);
});

test("timeout aborts the request and reports timeout", async () => {
  const { provider } = mk(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    { timeoutMs: 25 },
  );
  const r = await provider.lookup(SYNTHETIC_EMAIL);
  assert.equal(r.reason, R.TIMEOUT);
});

test("caller cancellation aborts the request and is not reported as a timeout", async () => {
  const ac = new AbortController();
  const { provider } = mk(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    { timeoutMs: 5000 },
  );
  const p = provider.lookup(SYNTHETIC_EMAIL, { signal: ac.signal });
  ac.abort();
  const r = await p;
  assert.equal(r.kind, RESULT_KIND.UNAVAILABLE);
  assert.notEqual(r.reason, R.TIMEOUT);
});

test("malformed or unexpected bodies become invalid_response, never a verdict", async () => {
  const bodies = [
    "not json at all",
    "",
    "null",
    "[]",
    "{}",
    JSON.stringify({ Error: "Not found", email: null }),
    JSON.stringify({ ...notFoundBody(), PastesSummary: null }),
    JSON.stringify({ ...notFoundBody(), BreachesSummary: { site: "Something" } }),
    JSON.stringify({ ...notFoundBody(), BreachMetrics: { risk: [] } }),
    JSON.stringify({ ExposedBreaches: { breaches_details: [] } }),
    JSON.stringify({ ExposedBreaches: { breaches_details: "nope" } }),
    JSON.stringify({ ExposedBreaches: [] }),
  ];
  for (const body of bodies) {
    const { provider } = mk(() => jsonResponse(body));
    const r = await provider.lookup(SYNTHETIC_EMAIL);
    assert.equal(r.kind, RESULT_KIND.UNAVAILABLE, body);
    assert.equal(r.reason, R.INVALID_RESPONSE, body);
  }
});

test("one malformed breach rejects the whole response instead of partial trust", async () => {
  const body = foundBody([breachDetail(), breachDetail({ breach: "" })]);
  const { provider } = mk(() => jsonResponse(body));
  const r = await provider.lookup(SYNTHETIC_EMAIL);
  assert.equal(r.reason, R.INVALID_RESPONSE);
});

test("paste-only exposure is not modelled, so it is not called clean", async () => {
  const body = { ...notFoundBody(), PastesSummary: { cnt: 2, domain: "x", tmpstmp: "" }, ExposedPastes: [{}] };
  const { provider } = mk(() => jsonResponse(body));
  const r = await provider.lookup(SYNTHETIC_EMAIL);
  assert.equal(r.kind, RESULT_KIND.UNAVAILABLE);
  assert.equal(r.reason, R.UNSUPPORTED_RESPONSE);
});

test("matches that the source has not verified are inconclusive, not confirmed", async () => {
  const body = foundBody([breachDetail({ verified: "No" }), breachDetail({ breach: "Other", verified: "maybe" })]);
  const { provider } = mk(() => jsonResponse(body));
  const r = await provider.lookup(SYNTHETIC_EMAIL);
  assert.equal(r.kind, RESULT_KIND.UNAVAILABLE);
  assert.equal(r.reason, R.UNVERIFIED_MATCH);
  assert.equal(r.breaches.length, 2);
  assert.ok(r.breaches.every((b) => b.verified === false));
});

test("mixed verified/unverified is confirmed, and each record keeps its own flag", async () => {
  const body = foundBody([breachDetail(), breachDetail({ breach: "Other", verified: "No" })]);
  const { provider } = mk(() => jsonResponse(body));
  const r = await provider.lookup(SYNTHETIC_EMAIL);
  assert.equal(r.kind, RESULT_KIND.CONFIRMED_BREACH);
  assert.deepEqual(r.breaches.map((b) => b.verified), [true, false]);
});

test("unsafe or odd field values are neutralised, not trusted", async () => {
  const body = foundBody([
    breachDetail({
      references: "javascript:alert(1)",
      xposed_date: "sometime",
      xposed_records: -5,
      password_risk: "<b>strong</b>",
      details: "<img src=x onerror=alert(1)>",
    }),
  ]);
  const { provider } = mk(() => jsonResponse(body));
  const r = await provider.lookup(SYNTHETIC_EMAIL);
  const [b] = r.breaches;
  assert.equal(b.referenceUrl, null);
  assert.equal(b.year, null);
  assert.equal(b.records, null);
  assert.equal(b.passwordRisk, "unknown");
  assert.equal(b.description, "<img src=x onerror=alert(1)>"); // kept as inert text; renderer uses textContent
});

test("oversized body is refused", async () => {
  const { provider } = mk(() => jsonResponse("x".repeat(2_000_001)));
  const r = await provider.lookup(SYNTHETIC_EMAIL);
  assert.equal(r.reason, R.INVALID_RESPONSE);
});

test("lookup requires an already validated, normalised address", async () => {
  const { provider, f } = mk(() => jsonResponse(notFoundBody()));
  await assert.rejects(provider.lookup("Not An Email"), TypeError);
  await assert.rejects(provider.lookup("UPPER@Example.com"), TypeError);
  assert.equal(f.calls.length, 0);
});

test("without a fetch implementation the provider reports itself unconfigured", async () => {
  const p = createXposedOrNotProvider({ fetchImpl: null });
  assert.equal(p.isConfigured, false);
  const r = await p.lookup(SYNTHETIC_EMAIL);
  assert.equal(r.reason, R.PROVIDER_UNCONFIGURED);
});

test("parseAnalyticsResponse is total: never throws on junk", () => {
  for (const junk of [undefined, null, 1, "s", [], {}, { ExposedBreaches: 5 }, { ExposedBreaches: { breaches_details: [null] } }]) {
    assert.doesNotThrow(() => parseAnalyticsResponse(junk));
    assert.ok(["invalid", "none", "found", "unsupported"].includes(parseAnalyticsResponse(junk).type));
  }
});
