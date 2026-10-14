import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createXposedOrNotProvider } from "../js/providers/xposedornot.js";
import { createXposedOrNotAutoProvider } from "../js/providers/xposedornot-auto.js";
import { createProvider } from "../js/providers/index.js";
import { handleXonRelay } from "../server/xon-relay.js";
import { createContext } from "../server/handler.js";
import { createIpLimiter } from "../server/limiter.js";
import { createAppServer } from "../server/app-server.mjs";
import { RESULT_KIND as K, UNAVAILABLE_REASON as R } from "../js/result-model.js";
import { SYNTHETIC_EMAIL, jsonResponse, fakeFetch, foundBody, notFoundBody } from "./helpers.mjs";

const relayReq = (body, over = {}) => ({ method: "POST", headers: { "content-type": "application/json", host: "site.test", ...over.headers }, bodyText: typeof body === "string" ? body : JSON.stringify(body), ip: over.ip ?? "203.0.113.5" });
const mkCtx = (f, extra = {}) => createContext({ env: {}, fetchImpl: f, ...extra });

test("relay mode: same-origin POST with the address in the body, never in a URL", async () => {
  const f = fakeFetch(() => jsonResponse(notFoundBody()));
  const r = await createXposedOrNotProvider({ fetchImpl: f, mode: "relay" }).lookup(SYNTHETIC_EMAIL);
  assert.equal(r.kind, K.NO_MATCH);
  const { url, init } = f.calls[0];
  assert.equal(url, "/api/xon");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "omit");
  assert.deepEqual(JSON.parse(init.body), { email: SYNTHETIC_EMAIL });
  assert.ok(!url.includes("@") && !url.includes("synthetic"));
});

test("auto provider: direct success is final and never touches the relay", async () => {
  const f = fakeFetch((url) => (url.startsWith("https://api.xposedornot.com/") ? jsonResponse(foundBody()) : assert.fail("relay used")));
  const r = await createXposedOrNotAutoProvider({ fetchImpl: f }).lookup(SYNTHETIC_EMAIL);
  assert.equal(r.kind, K.CONFIRMED_BREACH);
  assert.equal(f.calls.length, 1);
});

test("auto provider: falls back to the relay ONLY after a network-level failure (e.g. CORS block)", async () => {
  const f = fakeFetch((url) => {
    if (url.startsWith("https://")) throw new TypeError("Failed to fetch");
    return jsonResponse(foundBody());
  });
  const r = await createXposedOrNotAutoProvider({ fetchImpl: f }).lookup(SYNTHETIC_EMAIL);
  assert.equal(r.kind, K.CONFIRMED_BREACH);
  assert.deepEqual(f.calls.map((c) => c.url.startsWith("https://") ? "direct" : c.url), ["direct", "/api/xon"]);
});

test("auto provider: rate limits, provider errors and bad answers are final; the route is never switched to dodge them", async () => {
  for (const [res, reason] of [
    [() => jsonResponse({}, { status: 429, headers: { "retry-after": "20" } }), R.RATE_LIMITED],
    [() => jsonResponse("", { status: 500 }), R.PROVIDER_ERROR],
    [() => jsonResponse("not json"), R.INVALID_RESPONSE],
    [() => jsonResponse({ ExposedBreaches: [] }), R.INVALID_RESPONSE],
  ]) {
    const f = fakeFetch(res);
    const r = await createXposedOrNotAutoProvider({ fetchImpl: f }).lookup(SYNTHETIC_EMAIL);
    assert.equal(r.kind, K.UNAVAILABLE);
    assert.equal(r.reason, reason);
    assert.equal(f.calls.length, 1, "no retry through the relay");
  }
});

test("auto provider: both routes failing is 'unavailable', never a verdict", async () => {
  const f = fakeFetch(() => { throw new TypeError("offline"); });
  const r = await createXposedOrNotAutoProvider({ fetchImpl: f }).lookup(SYNTHETIC_EMAIL);
  assert.equal(r.kind, K.UNAVAILABLE);
  assert.equal(r.reason, R.NETWORK_ERROR);
  assert.equal(f.calls.length, 2);
});

test("auto provider: a user cancel does not trigger the relay", async () => {
  const ac = new AbortController();
  const f = fakeFetch((_u, init) => new Promise((_ok, bad) => init.signal.addEventListener("abort", () => bad(new DOMException("x", "AbortError")))));
  const p = createXposedOrNotAutoProvider({ fetchImpl: f }).lookup(SYNTHETIC_EMAIL, { signal: ac.signal });
  ac.abort();
  await p;
  assert.equal(f.calls.length, 1);
});

test("registry exposes the free providers and each carries a privacy disclosure", () => {
  for (const id of ["xposedornot-auto", "xposedornot", "xposedornot-relay", "hibp-server"]) {
    const p = createProvider({ provider: id });
    assert.ok(p.disclosure && p.disclosure.length > 30, id);
    assert.equal(p.isConfigured, true);
  }
});

// ---- server relay ----
test("relay passes through the provider's 200 body verbatim and sends no key", async () => {
  const body = JSON.stringify(foundBody());
  const f = fakeFetch(() => jsonResponse(body));
  const r = await handleXonRelay(relayReq({ email: "Synthetic.User@Example.com" }), mkCtx(f));
  assert.equal(r.status, 200);
  assert.equal(r.body, body);
  assert.equal(f.calls[0].url, "https://api.xposedornot.com/v1/breach-analytics?email=synthetic.user%40example.com");
  assert.ok(!JSON.stringify(f.calls[0].init.headers).toLowerCase().includes("key"));
  assert.equal(f.calls[0].init.redirect, "error");
});

test("relay: 429 is passed with Retry-After; every other upstream status becomes a 502 error, never a clean body", async () => {
  const rl = await handleXonRelay(relayReq({ email: SYNTHETIC_EMAIL }), mkCtx(fakeFetch(() => jsonResponse({}, { status: 429, headers: { "retry-after": "40" } }))));
  assert.equal(rl.status, 429);
  assert.equal(rl.headers["retry-after"], "40");
  assert.equal(JSON.parse(rl.body).retryAfterSeconds, 40);
  for (const status of [204, 301, 400, 403, 404, 500, 503]) {
    const r = await handleXonRelay(relayReq({ email: SYNTHETIC_EMAIL }), mkCtx(fakeFetch(() => jsonResponse(notFoundBody(), { status }))));
    assert.equal(r.status, 502, String(status));
    assert.equal(JSON.parse(r.body).state, "error");
  }
  const net = await handleXonRelay(relayReq({ email: SYNTHETIC_EMAIL }), mkCtx(fakeFetch(() => { throw new TypeError("x"); })));
  assert.equal(net.status, 502);
  assert.equal(JSON.parse(net.body).errorKind, "network");
});

test("relay: validation, origin and kill switch run before any upstream call", async () => {
  const f = fakeFetch(() => jsonResponse(notFoundBody()));
  const c = mkCtx(f);
  assert.equal((await handleXonRelay({ ...relayReq({}), method: "GET" }, c)).status, 405);
  assert.equal((await handleXonRelay(relayReq({ email: "nope" }), c)).status, 400);
  assert.equal((await handleXonRelay(relayReq({ email: SYNTHETIC_EMAIL }, { headers: { origin: "https://evil.test" } }), c)).status, 403);
  assert.equal((await handleXonRelay(relayReq({ email: SYNTHETIC_EMAIL }), { ...c, env: { XON_RELAY: "off" } })).status, 404);
  assert.equal(f.calls.length, 0);
});

test("relay: a shared hourly cap protects the one shared provider allowance", async () => {
  const f = fakeFetch(() => jsonResponse(notFoundBody()));
  let t = 0;
  const c = mkCtx(f, { limiter: createIpLimiter({ limit: 100, now: () => t }), globalLimiter: createIpLimiter({ limit: 2, windowMs: 3_600_000, now: () => t }) });
  assert.equal((await handleXonRelay(relayReq({ email: SYNTHETIC_EMAIL }, { ip: "1.1.1.1" }), c)).status, 200);
  assert.equal((await handleXonRelay(relayReq({ email: SYNTHETIC_EMAIL }, { ip: "2.2.2.2" }), c)).status, 200);
  const blocked = await handleXonRelay(relayReq({ email: SYNTHETIC_EMAIL }, { ip: "3.3.3.3" }), c);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers["retry-after"]) > 0);
  assert.equal(f.calls.length, 2);
});

test("end-to-end over real HTTP (local stand-in for XposedOrNot): relay returns the stand-in's body; app server hides private files", async () => {
  const seen = [];
  const fake = http.createServer((q, s) => { seen.push(q.url); s.writeHead(200, { "content-type": "application/json" }); s.end(JSON.stringify(notFoundBody())); });
  await new Promise((ok) => fake.listen(0, "127.0.0.1", ok));
  const app = await createAppServer({ env: {}, xonBaseUrl: `http://127.0.0.1:${fake.address().port}` });
  await new Promise((ok) => app.listen(0, "127.0.0.1", ok));
  try {
    const origin = `http://127.0.0.1:${app.address().port}`;
    const r = await fetch(`${origin}/api/xon`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: SYNTHETIC_EMAIL }) });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), notFoundBody());
    assert.equal(seen[0], "/v1/breach-analytics?email=synthetic.user%40example.com");
    // the full browser-side relay provider against the real HTTP relay
    const provider = createXposedOrNotProvider({ mode: "relay", relayPath: `${origin}/api/xon` });
    assert.equal((await provider.lookup(SYNTHETIC_EMAIL)).kind, K.NO_MATCH);
    assert.equal((await fetch(`${origin}/server/xon-relay.js`)).status, 404);
  } finally { app.close(); fake.close(); }
});
