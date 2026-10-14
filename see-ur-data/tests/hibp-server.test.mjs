import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  resolveConfig, classifyResponse, normaliseBreach, queryBreachedAccount,
  HIBP_TEST_API_KEY, NOT_CONFIGURED_MESSAGE,
} from "../server/hibp.js";
import { handleCheck, handleStatus, createContext } from "../server/handler.js";
import { createIpLimiter } from "../server/limiter.js";
import { createAppServer } from "../server/app-server.mjs";

// Synthetic production-style key used only in tests. It must never be echoed anywhere.
const PROD_KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const TEST_ACCOUNT = "account-exists@hibp-integration-tests.com";
const REAL_LOOKING = "synthetic.user@example.com";

const sampleBreach = (o = {}) => ({
  Name: "ExampleBreach", Title: "Example Breach", Domain: "example.invalid", BreachDate: "2019-03-02",
  PwnCount: 12345, Description: 'A <em>made-up</em> fixture with a <a href="https://example.com">link</a> &amp; entity.',
  DataClasses: ["Email addresses", "Passwords"], IsVerified: true, IsFabricated: false, IsSpamList: false,
  IsStealerLog: false, IsMalware: false, IsSensitive: false, IsRetired: false, ...o,
});
const res = (status, body = "", headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});
const upstream = (responder) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return responder(url, init); }; f.calls = calls; return f; };
const req = (body, over = {}) => ({ method: "POST", headers: { "content-type": "application/json", host: "site.test", ...over.headers }, bodyText: typeof body === "string" ? body : JSON.stringify(body), ip: over.ip ?? "203.0.113.1" });
const ctx = (env, fetchImpl, extra = {}) => createContext({ env, fetchImpl, ...extra });
const parse = (r) => JSON.parse(r.body);

test("resolveConfig: production needs a well-formed real key; test mode never uses HIBP_API_KEY", () => {
  assert.deepEqual(resolveConfig({}), { state: "not_configured", reason: "missing_key" });
  assert.deepEqual(resolveConfig({ HIBP_API_KEY: "   " }), { state: "not_configured", reason: "missing_key" });
  assert.equal(resolveConfig({ HIBP_API_KEY: "short" }).reason, "malformed_key");
  assert.equal(resolveConfig({ HIBP_API_KEY: "g".repeat(32) }).reason, "malformed_key");
  assert.equal(resolveConfig({ HIBP_API_KEY: HIBP_TEST_API_KEY }).reason, "test_key_in_production");
  assert.equal(resolveConfig({ HIBP_MODE: "weird", HIBP_API_KEY: PROD_KEY }).reason, "unknown_mode");
  assert.deepEqual(resolveConfig({ HIBP_API_KEY: PROD_KEY }), { state: "ready", mode: "production", apiKey: PROD_KEY });
  assert.deepEqual(resolveConfig({ HIBP_MODE: " TEST " }), { state: "ready", mode: "test", apiKey: HIBP_TEST_API_KEY });
  assert.equal(resolveConfig({ HIBP_MODE: "test", HIBP_API_KEY: PROD_KEY }).reason, "conflicting_config");
});

test("classifyResponse: ONLY a genuine HTTP 404 means 'not found'; every other status is its own outcome", () => {
  const body = JSON.stringify([sampleBreach()]);
  const table = [
    [200, body, "breached"], [200, "[]", "error:invalid_response"], [200, "oops", "error:invalid_response"],
    [200, JSON.stringify({ Name: "x" }), "error:invalid_response"], [200, JSON.stringify([{ Name: "x" }]), "error:invalid_response"],
    [404, "", "not_found"], [404, '{"statusCode":404,"message":"Resource not found"}', "not_found"],
    [400, "", "error:bad_request"], [401, "Access denied due to invalid hibp-api-key.", "error:authentication"],
    [403, "", "error:access_denied"], [429, "", "error:rate_limited"],
    [500, "", "error:server_error"], [502, "", "error:server_error"], [503, "", "error:server_error"],
    [301, "", "error:unexpected_status"], [204, "", "error:unexpected_status"], [418, "", "error:unexpected_status"],
  ];
  for (const [status, bodyText, expected] of table) {
    const r = classifyResponse({ status, bodyText });
    const got = r.state === "error" ? `error:${r.errorKind}` : r.state;
    assert.equal(got, expected, `HTTP ${status}`);
  }
  const notFound = Array.from({ length: 600 }, (_, i) => 100 + i).filter((s) => classifyResponse({ status: s }).state === "not_found");
  assert.deepEqual(notFound, [404]);
  assert.equal(classifyResponse({ status: 404, contentType: "text/html", bodyText: "<html>x</html>" }).errorKind, "unexpected_status");
  assert.equal(classifyResponse({ status: 404, bodyText: "<!DOCTYPE html><html>" }).errorKind, "unexpected_status");
  assert.equal(classifyResponse({ status: 429, retryAfter: "7" }).retryAfterSeconds, 7);
  assert.equal(classifyResponse({ status: 429 }).retryAfterSeconds, null);
});

test("normaliseBreach: strips markup, never calls fabricated data verified, labels categories", () => {
  const b = normaliseBreach(sampleBreach());
  assert.equal(b.description, "A made-up fixture with a link & entity.");
  assert.equal(b.year, "2019");
  assert.equal(b.verified, true);
  assert.equal(b.category, null);
  assert.equal(normaliseBreach(sampleBreach({ IsFabricated: true })).verified, false);
  assert.equal(normaliseBreach(sampleBreach({ IsFabricated: true })).category, "fabricated");
  assert.equal(normaliseBreach(sampleBreach({ IsSpamList: true })).category, "spam_list");
  assert.equal(normaliseBreach(sampleBreach({ IsStealerLog: true })).category, "stealer_log");
  assert.equal(normaliseBreach(sampleBreach({ IsVerified: false })).verified, false);
  assert.equal(normaliseBreach(sampleBreach({ IsVerified: undefined })), null);
  assert.equal(normaliseBreach({ Name: "" }), null);
  assert.equal(normaliseBreach(null), null);
});

test("handler: missing key shows the exact not-configured message and makes NO upstream call", async () => {
  const f = upstream(() => res(200, [sampleBreach()]));
  const r = await handleCheck(req({ email: REAL_LOOKING }), ctx({}, f));
  assert.equal(r.status, 503);
  const b = parse(r);
  assert.equal(b.state, "not_configured");
  assert.equal(b.message, "Live email breach lookup is not configured yet.");
  assert.equal(b.message, NOT_CONFIGURED_MESSAGE);
  assert.equal(f.calls.length, 0);
  assert.ok(!("breaches" in b));
  for (const env of [{ HIBP_API_KEY: "bad" }, { HIBP_API_KEY: HIBP_TEST_API_KEY }, { HIBP_MODE: "test", HIBP_API_KEY: PROD_KEY }]) {
    const x = await handleCheck(req({ email: REAL_LOOKING }), ctx(env, f));
    assert.equal(parse(x).state, "not_configured");
  }
  assert.equal(f.calls.length, 0);
  const s = parse(handleStatus({ method: "GET", headers: {} }, ctx({}, f)));
  assert.deepEqual(s, { state: "not_configured", message: NOT_CONFIGURED_MESSAGE, mode: null });
});

test("handler: production sends the real key + user agent server-side; the key never reaches any response", async () => {
  const f = upstream(() => res(200, [sampleBreach()]));
  const r = await handleCheck(req({ email: "  Synthetic.User@Example.com " }), ctx({ HIBP_API_KEY: PROD_KEY }, f));
  assert.equal(r.status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://haveibeenpwned.com/api/v3/breachedaccount/synthetic.user%40example.com?truncateResponse=false");
  assert.equal(f.calls[0].init.headers["hibp-api-key"], PROD_KEY);
  assert.match(f.calls[0].init.headers["user-agent"], /\S/);
  assert.equal(f.calls[0].init.redirect, "error");
  const b = parse(r);
  assert.equal(b.state, "breached");
  assert.equal(b.mode, "production");
  assert.equal(b.upstreamStatus, 200);
  assert.equal(b.breaches[0].title, "Example Breach");
  assert.ok(!JSON.stringify([r.headers, r.body]).includes(PROD_KEY));
});

test("handler: upstream statuses map to distinct outcomes and HTTP codes; none leaks the key", async () => {
  const cases = [
    [404, "", "not_found", null, 200], [401, "Access denied due to invalid hibp-api-key.", "error", "authentication", 502],
    [403, "", "error", "access_denied", 502], [429, "", "error", "rate_limited", 429],
    [500, "", "error", "server_error", 502], [503, "", "error", "server_error", 502], [400, "", "error", "bad_request", 502],
  ];
  const seen = new Set();
  for (const [status, body, state, kind, httpCode] of cases) {
    const r = await handleCheck(req({ email: REAL_LOOKING }), ctx({ HIBP_API_KEY: PROD_KEY }, upstream(() => res(status, body, { "retry-after": "9" }))));
    const b = parse(r);
    assert.equal(b.state, state, `HTTP ${status}`);
    assert.equal(b.errorKind ?? null, kind, `HTTP ${status}`);
    assert.equal(b.upstreamStatus, status);
    assert.equal(r.status, httpCode);
    assert.ok(!JSON.stringify([r.headers, r.body]).includes(PROD_KEY));
    assert.ok(!("breaches" in b), `HTTP ${status} must carry no breach list`);
    seen.add(`${state}/${kind}`);
  }
  assert.equal(seen.size, 6, "401, 403, 429, 5xx and 404 stay distinguishable (500/503 share server_error)");
  const rl = parse(await handleCheck(req({ email: REAL_LOOKING }), ctx({ HIBP_API_KEY: PROD_KEY }, upstream(() => res(429, "", { "retry-after": "9" })))));
  assert.equal(rl.retryAfterSeconds, 9);
});

test("handler: network failure and timeout are errors, never a verdict", async () => {
  const net = await handleCheck(req({ email: REAL_LOOKING }), ctx({ HIBP_API_KEY: PROD_KEY }, upstream(() => { throw new TypeError("fetch failed"); })));
  assert.equal(net.status, 502);
  assert.deepEqual([parse(net).state, parse(net).errorKind, parse(net).upstreamStatus], ["error", "network", null]);
  const slow = upstream((_u, init) => new Promise((_ok, bad) => init.signal.addEventListener("abort", () => bad(new DOMException("x", "AbortError")))));
  const to = await handleCheck(req({ email: REAL_LOOKING }), ctx({ HIBP_API_KEY: PROD_KEY }, slow, { timeoutMs: 20 }));
  assert.equal(to.status, 504);
  assert.equal(parse(to).errorKind, "timeout");
});

test("handler: test mode uses ONLY the documented test key, only for test-domain addresses", async () => {
  const f = upstream(() => res(200, [sampleBreach({ Name: "TestBreach" })]));
  const r = await handleCheck(req({ email: TEST_ACCOUNT }), ctx({ HIBP_MODE: "test" }, f));
  assert.equal(f.calls[0].init.headers["hibp-api-key"], HIBP_TEST_API_KEY);
  assert.equal(parse(r).mode, "test");
  const g = upstream(() => res(200, [sampleBreach()]));
  const refused = await handleCheck(req({ email: REAL_LOOKING }), ctx({ HIBP_MODE: "test" }, g));
  assert.equal(refused.status, 400);
  assert.equal(parse(refused).code, "test_mode_domain_only");
  assert.equal(g.calls.length, 0, "test mode must not query real addresses");
});

test("handler: production refuses the test domain, so test data is never shown through a production lookup", async () => {
  const f = upstream(() => res(200, [sampleBreach()]));
  const r = await handleCheck(req({ email: TEST_ACCOUNT }), ctx({ HIBP_API_KEY: PROD_KEY }, f));
  assert.equal(r.status, 400);
  assert.equal(parse(r).code, "test_domain_reserved");
  assert.equal(f.calls.length, 0);
});

test("handler: input, origin, media-type and size checks happen before anything else", async () => {
  const f = upstream(() => res(200, [sampleBreach()]));
  const c = ctx({ HIBP_API_KEY: PROD_KEY }, f);
  assert.equal((await handleCheck({ ...req({}), method: "GET" }, c)).status, 405);
  assert.equal((await handleCheck(req({ email: REAL_LOOKING }, { headers: { origin: "https://evil.test" } }), c)).status, 403);
  assert.equal((await handleCheck(req({ email: REAL_LOOKING }, { headers: { origin: "not a url" } }), c)).status, 403);
  assert.equal((await handleCheck(req({ email: REAL_LOOKING }, { headers: { origin: "https://site.test" } }), c)).status, 200);
  assert.equal((await handleCheck(req({ email: REAL_LOOKING }, { headers: { "content-type": "text/plain" } }), c)).status, 415);
  assert.equal((await handleCheck(req("{" + " ".repeat(2000) + "}"), c)).status, 413);
  assert.equal(parse(await handleCheck(req("not json"), c)).code, "bad_json");
  for (const bad of [{}, { email: 5 }, { email: "nope" }, { email: "a@@b.com" }, null, []]) {
    const r = await handleCheck(req(bad), c);
    assert.equal(r.status, 400);
    assert.equal(parse(r).state, "invalid_input");
  }
  assert.equal(f.calls.length, 1, "only the one valid same-origin request reached HIBP");
});

test("handler: per-IP rate limit blocks before contacting HIBP", async () => {
  const f = upstream(() => res(404));
  let t = 0;
  const c = ctx({ HIBP_API_KEY: PROD_KEY }, f, { limiter: createIpLimiter({ limit: 2, windowMs: 60_000, now: () => t }) });
  assert.equal((await handleCheck(req({ email: REAL_LOOKING }), c)).status, 200);
  assert.equal((await handleCheck(req({ email: REAL_LOOKING }), c)).status, 200);
  const blocked = await handleCheck(req({ email: REAL_LOOKING }), c);
  assert.equal(blocked.status, 429);
  assert.equal(parse(blocked).errorKind, "rate_limited_local");
  assert.ok(Number(blocked.headers["retry-after"]) >= 1);
  assert.equal(f.calls.length, 2);
  assert.equal((await handleCheck(req({ email: REAL_LOOKING }, { ip: "198.51.100.9" }), c)).status, 200, "other clients unaffected");
});

test("limiter stores IPs and timestamps only", () => {
  let t = 0;
  const l = createIpLimiter({ limit: 1, windowMs: 1000, now: () => t });
  assert.equal(l.check("a").allowed, true);
  assert.equal(l.check("a").allowed, false);
  t = 1001;
  assert.equal(l.check("a").allowed, true);
});

test("queryBreachedAccount never throws and reports upstreamStatus null on network failure", async () => {
  const r = await queryBreachedAccount({ email: REAL_LOOKING, apiKey: PROD_KEY, fetchImpl: async () => { throw new TypeError("x"); } });
  assert.equal(r.upstreamStatus, null);
  assert.equal(r.outcome.errorKind, "network");
});

test("server code never logs and never contains a literal production key", async () => {
  const dir = fileURLToPath(new URL("../server/", import.meta.url));
  for (const f of await readdir(dir)) {
    const src = (await readFile(dir + f, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(src, /\bconsole\s*\./, f);
    const hex = [...src.matchAll(/["'`]([0-9a-f]{32})["'`]/gi)].map((m) => m[1]);
    assert.deepEqual(hex.filter((h) => h !== HIBP_TEST_API_KEY), [], `${f} contains a key-like literal`);
  }
  for (const f of ["../functions/api/check.js", "../functions/api/status.js"]) {
    assert.doesNotMatch(await readFile(new URL(f, import.meta.url), "utf8"), /console\s*\./);
  }
});

// ---- Real HTTP plumbing against a LOCAL stand-in for HIBP (a simulation, not HIBP) ----
async function withStack({ env, handler }, fn) {
  const seen = [];
  const fake = http.createServer((q, s) => { seen.push({ url: q.url, headers: q.headers }); handler(q, s); });
  await new Promise((ok) => fake.listen(0, "127.0.0.1", ok));
  const baseUrl = `http://127.0.0.1:${fake.address().port}/api/v3`;
  const app = await createAppServer({ env, baseUrl });
  await new Promise((ok) => app.listen(0, "127.0.0.1", ok));
  const origin = `http://127.0.0.1:${app.address().port}`;
  try { return await fn({ origin, seen }); } finally { app.close(); fake.close(); }
}
const post = (origin, email) => fetch(`${origin}/api/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });

test("end-to-end over real HTTP (local stand-in): test account returns the stand-in's breach list, headers are correct", async () => {
  await withStack({ env: { HIBP_MODE: "test" }, handler: (_q, s) => { s.writeHead(200, { "content-type": "application/json" }); s.end(JSON.stringify([sampleBreach({ Name: "StandIn" })])); } }, async ({ origin, seen }) => {
    const r = await post(origin, TEST_ACCOUNT);
    const b = await r.json();
    assert.equal(r.status, 200);
    assert.equal(b.state, "breached");
    assert.equal(b.upstreamStatus, 200);
    assert.equal(b.breaches[0].name, "StandIn");
    assert.equal(seen[0].url, "/api/v3/breachedaccount/account-exists%40hibp-integration-tests.com?truncateResponse=false");
    assert.equal(seen[0].headers["hibp-api-key"], HIBP_TEST_API_KEY);
    assert.ok(seen[0].headers["user-agent"]);
    assert.ok(!JSON.stringify(b).includes(HIBP_TEST_API_KEY));
    const status = await (await fetch(`${origin}/api/status`)).json();
    assert.deepEqual(status, { state: "ready", mode: "test" });
  });
});

test("end-to-end: genuine 404 => not_found; 401/403/503 stay distinct; key never in any response", async () => {
  for (const [code, state, kind] of [[404, "not_found", undefined], [401, "error", "authentication"], [403, "error", "access_denied"], [503, "error", "server_error"]]) {
    await withStack({ env: { HIBP_API_KEY: PROD_KEY }, handler: (_q, s) => { s.writeHead(code); s.end(); } }, async ({ origin }) => {
      const r = await post(origin, REAL_LOOKING);
      const text = await r.text();
      const b = JSON.parse(text);
      assert.equal(b.state, state);
      assert.equal(b.errorKind, kind);
      assert.equal(b.upstreamStatus, code);
      assert.ok(!text.includes(PROD_KEY));
      assert.ok(!JSON.stringify([...r.headers]).includes(PROD_KEY));
    });
  }
});

test("end-to-end: unconfigured server, forbidden origin, private files and traversal", async () => {
  await withStack({ env: {}, handler: (_q, s) => s.end() }, async ({ origin, seen }) => {
    const r = await post(origin, REAL_LOOKING);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).message, "Live email breach lookup is not configured yet.");
    assert.equal(seen.length, 0);
    const bad = await fetch(`${origin}/api/check`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.test" }, body: JSON.stringify({ email: REAL_LOOKING }) });
    assert.equal(bad.status, 403);
    for (const p of ["/server/hibp.js", "/functions/api/check.js", "/package.json", "/_headers", "/tests/helpers.mjs", "/.gitignore", "/scripts/check-links.mjs"]) {
      assert.equal((await fetch(origin + p)).status, 404, p);
    }
    assert.equal((await fetch(`${origin}/%2e%2e/%2e%2e/etc/passwd`)).status, 404);
    const home = await fetch(`${origin}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-security-policy"), /connect-src 'self'/);
  });
});
