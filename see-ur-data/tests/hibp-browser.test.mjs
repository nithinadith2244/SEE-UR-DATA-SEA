import test from "node:test";
import assert from "node:assert/strict";
import { createHibpServerProvider, interpretEnvelope } from "../js/providers/hibp-server.js";
import { toViewModel } from "../js/view-model.js";
import { createController } from "../js/controller.js";
import { createRateGate } from "../js/rate-gate.js";
import { RESULT_KIND as K, UNAVAILABLE_REASON as R, isGenuineResult } from "../js/result-model.js";

const breach = (o = {}) => ({ name: "ExampleBreach", title: "Example Breach", domain: "example.invalid", year: "2019", records: 1000, description: "Plain text.", exposedData: ["Email addresses"], verified: true, category: null, ...o });
const breached = (o = {}) => ({ state: "breached", mode: "production", upstreamStatus: 200, breaches: [breach()], ...o });
const resp = (status, body) => ({ status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
const stubFetch = (fn) => { const f = async (url, init) => { f.calls.push({ url, init }); return fn(url, init); }; f.calls = []; return f; };

test("not_found is shown as 'no match' ONLY with HTTP 200 + upstreamStatus 404", () => {
  const ok = interpretEnvelope(200, { state: "not_found", mode: "production", upstreamStatus: 404 });
  assert.equal(ok.kind, K.NO_MATCH);
  for (const [http, body] of [
    [200, { state: "not_found", mode: "production", upstreamStatus: null }],
    [200, { state: "not_found", mode: "production", upstreamStatus: 200 }],
    [200, { state: "not_found", mode: "production", upstreamStatus: 401 }],
    [200, { state: "not_found", mode: "production" }],
    [200, { state: "not_found", upstreamStatus: 404 }],            // no mode
    [200, { state: "not_found", mode: "staging", upstreamStatus: 404 }],
    [404, { state: "not_found", mode: "production", upstreamStatus: 404 }], // a bare 404 from a host in the middle
    [500, { state: "not_found", mode: "production", upstreamStatus: 404 }],
  ]) {
    const r = interpretEnvelope(http, body);
    assert.equal(r.kind, K.UNAVAILABLE, JSON.stringify([http, body]));
  }
});

test("error kinds map to distinct, honest reasons", () => {
  const map = {
    authentication: R.AUTHENTICATION_ERROR, access_denied: R.ACCESS_DENIED, rate_limited: R.RATE_LIMITED,
    rate_limited_local: R.RATE_LIMITED, server_error: R.SERVER_ERROR, bad_request: R.BAD_REQUEST,
    timeout: R.TIMEOUT, network: R.NETWORK_ERROR, invalid_response: R.INVALID_RESPONSE, unexpected_status: R.PROVIDER_ERROR,
    something_new: R.PROVIDER_ERROR,
  };
  const headlines = new Set();
  for (const [kind, reason] of Object.entries(map)) {
    const r = interpretEnvelope(502, { state: "error", errorKind: kind, mode: "production", upstreamStatus: null });
    assert.equal(r.kind, K.UNAVAILABLE);
    assert.equal(r.reason, reason, kind);
    headlines.add(toViewModel(r).headline);
  }
  assert.ok(headlines.size >= 8, "headlines for auth, access, rate limit, server, timeout, network etc. differ");
  assert.equal(interpretEnvelope(429, { state: "error", errorKind: "rate_limited", retryAfterSeconds: 12, mode: "production" }).retryAfterSeconds, 12);
});

test("not configured shows the exact required message and is never a verdict", () => {
  const r = interpretEnvelope(503, { state: "not_configured", message: "whatever", upstreamStatus: null });
  assert.equal(r.reason, R.SERVER_NOT_CONFIGURED);
  const vm = toViewModel(r);
  assert.equal(vm.headline, "Live email breach lookup is not configured yet.");
  assert.doesNotMatch(JSON.stringify(vm), /no breaches found|no match|not found/i);
});

test("breach results require upstream 200 and well-formed records", () => {
  const ok = interpretEnvelope(200, breached());
  assert.equal(ok.kind, K.CONFIRMED_BREACH);
  assert.equal(ok.breaches[0].name, "Example Breach");
  assert.equal(ok.provider.name, "Have I Been Pwned");
  for (const [http, body] of [
    [200, breached({ upstreamStatus: 404 })], [200, breached({ upstreamStatus: null })], [500, breached()],
    [200, breached({ breaches: [] })], [200, breached({ breaches: undefined })], [200, breached({ breaches: [{ title: "" }] })],
    [200, breached({ mode: undefined })],
  ]) {
    assert.equal(interpretEnvelope(http, body).kind, K.UNAVAILABLE, JSON.stringify([http, body]).slice(0, 80));
  }
});

test("unverified-only matches are inconclusive; fabricated breaches are labelled and never verified", () => {
  const r = interpretEnvelope(200, breached({ breaches: [breach({ verified: false })] }));
  assert.equal(r.reason, R.UNVERIFIED_MATCH);
  const fab = interpretEnvelope(200, breached({ breaches: [breach(), breach({ title: "Fake", verified: false, category: "fabricated" })] }));
  const vm = toViewModel(fab);
  assert.ok(vm.cards[1].facts.some((f) => f.label === "Type" && /Fabricated/.test(f.value)));
  assert.equal(vm.cards[1].verifiedLabel, "Not verified by the source");
});

test("test-mode results are clearly labelled and cannot pass as real", () => {
  const vm = toViewModel(interpretEnvelope(200, breached({ mode: "test" })));
  assert.match(vm.headline, /^Test mode: /);
  assert.match(vm.notes[0], /TEST MODE.*synthetic.*real email address/i);
  const nm = toViewModel(interpretEnvelope(200, { state: "not_found", mode: "test", upstreamStatus: 404 }));
  assert.match(nm.headline, /^Test mode: /);
  const prod = toViewModel(interpretEnvelope(200, breached()));
  assert.doesNotMatch(prod.headline + prod.notes.join(" "), /test mode/i);
});

test("garbage envelopes never become verdicts", () => {
  for (const body of [null, undefined, 5, "x", [], {}, { state: 5 }, { state: "mystery" }, { state: "breached" }, { verdict: "clean" }]) {
    const r = interpretEnvelope(200, body);
    assert.equal(r.kind, K.UNAVAILABLE, JSON.stringify(body));
    assert.ok(isGenuineResult(r));
  }
});

test("provider request: same-origin POST, JSON body, no credentials, no referrer, no absolute URL", async () => {
  const f = stubFetch(() => resp(200, { state: "not_found", mode: "production", upstreamStatus: 404 }));
  const p = createHibpServerProvider({ fetchImpl: f });
  const r = await p.lookup("synthetic.user@example.com");
  assert.equal(r.kind, K.NO_MATCH);
  const { url, init } = f.calls[0];
  assert.equal(url, "/api/check");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "omit");
  assert.equal(init.referrerPolicy, "no-referrer");
  assert.equal(init.cache, "no-store");
  assert.deepEqual(JSON.parse(init.body), { email: "synthetic.user@example.com" });
  assert.deepEqual(Object.keys(init.headers).sort(), ["accept", "content-type"]);
});

test("a static host's HTML 404 for the missing /api route is NOT a clean result", async () => {
  for (const status of [404, 405, 200, 500]) {
    const p = createHibpServerProvider({ fetchImpl: stubFetch(() => resp(status, "<!doctype html><html><body>Not found</body></html>")) });
    const r = await p.lookup("synthetic.user@example.com");
    assert.equal(r.kind, K.UNAVAILABLE, String(status));
    assert.equal(r.reason, R.PROVIDER_ERROR);
  }
  const empty = createHibpServerProvider({ fetchImpl: stubFetch(() => resp(404, "")) });
  assert.equal((await empty.lookup("synthetic.user@example.com")).kind, K.UNAVAILABLE);
});

test("network failure and timeout are unavailable, never a verdict", async () => {
  const net = createHibpServerProvider({ fetchImpl: stubFetch(() => { throw new TypeError("Failed to fetch"); }) });
  assert.equal((await net.lookup("synthetic.user@example.com")).reason, R.NETWORK_ERROR);
  const slow = createHibpServerProvider({
    timeoutMs: 20,
    fetchImpl: stubFetch((_u, init) => new Promise((_ok, bad) => init.signal.addEventListener("abort", () => bad(new DOMException("x", "AbortError"))))),
  });
  assert.equal((await slow.lookup("synthetic.user@example.com")).reason, R.TIMEOUT);
});

test("status(): reports server state, and null (not a verdict) when unreachable or malformed", async () => {
  const ready = createHibpServerProvider({ fetchImpl: stubFetch(() => resp(200, { state: "ready", mode: "test" })) });
  assert.deepEqual(await ready.status(), { state: "ready", mode: "test" });
  const nc = createHibpServerProvider({ fetchImpl: stubFetch(() => resp(200, { state: "not_configured", mode: null })) });
  assert.deepEqual(await nc.status(), { state: "not_configured", mode: null });
  for (const bad of [stubFetch(() => resp(404, "<html>")), stubFetch(() => { throw new TypeError("x"); }), stubFetch(() => resp(200, { state: "ready", extra: 1 }))]) {
    const r = await createHibpServerProvider({ fetchImpl: bad }).status();
    assert.ok(r === null || r.state === "ready");
  }
  assert.equal(await createHibpServerProvider({ fetchImpl: stubFetch(() => resp(500, { state: "ready" })) }).status(), null);
});

test("controller + provider: a 401 from HIBP renders as an authentication error, not 'no breaches'", async () => {
  const p = createHibpServerProvider({ fetchImpl: stubFetch(() => resp(502, { state: "error", errorKind: "authentication", mode: "production", upstreamStatus: 401 })) });
  const states = [];
  const c = createController({ provider: p, gate: createRateGate(), render: (s) => states.push(s) });
  await c.submit("synthetic.user@example.com");
  const vm = toViewModel(states.at(-1).result);
  assert.equal(vm.tone, "unavailable");
  assert.match(vm.headline, /rejected this site's credentials/);
  assert.doesNotMatch(JSON.stringify(vm), /no breaches|no match/i);
});
