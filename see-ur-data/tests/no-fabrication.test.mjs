import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../js/config.js";
import { createProvider } from "../js/providers/index.js";
import { createUnconfiguredProvider } from "../js/providers/unconfigured.js";
import { createController } from "../js/controller.js";
import { createRateGate } from "../js/rate-gate.js";
import {
  confirmedBreach, noMatch, unavailable, isGenuineResult, makeBreach,
  RESULT_KIND, UNAVAILABLE_REASON as R,
} from "../js/result-model.js";
import { SYNTHETIC_EMAIL } from "./helpers.mjs";

const INFO = { id: "synthetic", name: "Synthetic Source", url: "https://example.com" };
const B = (over = {}) => ({ name: "ExampleBreach", verified: true, ...over });

test("shipped configuration uses the free provider and holds no key", () => {
  assert.equal(config.provider, "xposedornot-auto");
  assert.equal(createProvider(config).id, "xposedornot-auto");
  assert.equal(createProvider({ provider: "hibp-server" }).id, "hibp");
  assert.doesNotMatch(JSON.stringify(config), /[0-9a-f]{32}/i, "no 32-hex key-like value in public config");
  assert.equal(createProvider({ provider: "none" }).isConfigured, false);
});

test("unknown, empty or mistyped provider ids fall back to unconfigured", () => {
  for (const p of [undefined, null, "", "none", "HIBP", "hibp", "xposedornott", {}, 5]) {
    assert.equal(createProvider({ provider: p }).isConfigured, false, String(p));
  }
  assert.equal(createProvider(undefined).isConfigured, false);
});

test("unconfigured provider answers unavailable and makes no network request", async () => {
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = () => { called++; throw new Error("network must not be used"); };
  try {
    const r = await createUnconfiguredProvider().lookup(SYNTHETIC_EMAIL);
    assert.equal(r.kind, RESULT_KIND.UNAVAILABLE);
    assert.equal(r.reason, R.PROVIDER_UNCONFIGURED);
    assert.equal(r.breaches, null);
    assert.equal(called, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("constructors refuse to mint verdicts without real evidence", () => {
  assert.throws(() => confirmedBreach({ provider: INFO, breaches: [] }), TypeError);
  assert.throws(() => confirmedBreach({ provider: INFO, breaches: undefined }), TypeError);
  assert.throws(() => confirmedBreach({ provider: INFO, breaches: [B({ verified: false })] }), TypeError);
  assert.throws(() => confirmedBreach({ provider: INFO, breaches: [{ verified: true }] }), TypeError);
  assert.throws(() => confirmedBreach({ provider: INFO, breaches: [B({ verified: "Yes" })] }), TypeError);
  assert.throws(() => confirmedBreach({ provider: undefined, breaches: [B()] }), TypeError);
  assert.throws(() => confirmedBreach({ provider: { ...INFO, url: "http://example.com" }, breaches: [B()] }), TypeError);
  assert.throws(() => noMatch({}), TypeError);
  assert.throws(() => noMatch({ provider: { id: "x", name: "", url: "https://example.com" } }), TypeError);
  assert.throws(() => unavailable({ reason: "made_up" }), TypeError);
  assert.throws(() => makeBreach(null), TypeError);
});

test("genuine results are frozen and registered; forged look-alikes are not", () => {
  const real = noMatch({ provider: INFO });
  assert.equal(isGenuineResult(real), true);
  assert.ok(Object.isFrozen(real));
  const forgedNoMatch = { kind: "no_match", provider: INFO };
  const forgedBreach = { kind: "confirmed_breach", provider: INFO, breaches: [B()] };
  const clone = { ...real };
  for (const f of [forgedNoMatch, forgedBreach, clone, null, undefined, "no_match", 1]) {
    assert.equal(isGenuineResult(f), false);
  }
});

function harness({ provider, gate = createRateGate() }) {
  const states = [];
  const controller = createController({ provider, gate, render: (s) => states.push(s) });
  return { controller, states, gate };
}
const last = (states) => states[states.length - 1];
const configured = (lookup) => ({ id: "t", isConfigured: true, info: INFO, lookup });

test("controller discards a forged result from a misbehaving provider", async () => {
  const forged = { kind: "no_match", provider: INFO };
  const { controller, states } = harness({ provider: configured(async () => forged) });
  await controller.submit(SYNTHETIC_EMAIL);
  assert.equal(last(states).name, "result");
  assert.equal(last(states).result.kind, RESULT_KIND.UNAVAILABLE);
  assert.equal(last(states).result.reason, R.INVALID_RESPONSE);
});

test("controller turns a provider crash into 'unavailable', not a verdict", async () => {
  const { controller, states } = harness({ provider: configured(async () => { throw new Error("boom"); }) });
  await controller.submit(SYNTHETIC_EMAIL);
  assert.equal(last(states).result.reason, R.PROVIDER_ERROR);
});

test("invalid input never reaches the provider or the rate gate", async () => {
  let calls = 0;
  const { controller, states } = harness({ provider: configured(async () => { calls++; return noMatch({ provider: INFO }); }) });
  await controller.submit("not-an-email");
  assert.equal(calls, 0);
  assert.equal(last(states).name, "invalid");
  assert.equal(last(states).error.code, "no_at");
});

test("unconfigured provider: validated input yields unavailable and consumes no rate allowance", async () => {
  const gate = createRateGate({ windows: [{ limit: 1, ms: 60000 }] });
  const { controller, states } = harness({ provider: createUnconfiguredProvider(), gate });
  for (let i = 0; i < 4; i++) await controller.submit(SYNTHETIC_EMAIL);
  assert.ok(states.every((s) => s.name === "result" && s.result.reason === R.PROVIDER_UNCONFIGURED));
});

test("loading then result; double submit while busy is ignored", async () => {
  let release;
  let calls = 0;
  const provider = configured(() => new Promise((res) => { calls++; release = () => res(noMatch({ provider: INFO })); }));
  const { controller, states } = harness({ provider });
  const first = controller.submit(SYNTHETIC_EMAIL);
  await Promise.resolve();
  assert.equal(controller.isBusy(), true);
  await controller.submit(SYNTHETIC_EMAIL);
  assert.equal(calls, 1);
  release();
  await first;
  assert.deepEqual(states.map((s) => s.name), ["loading", "result"]);
  assert.equal(last(states).result.kind, RESULT_KIND.NO_MATCH);
  assert.equal(controller.isBusy(), false);
});

test("cancel drops a late answer instead of showing it", async () => {
  let release;
  const provider = configured((_e, { signal }) => new Promise((res) => {
    release = () => res(noMatch({ provider: INFO }));
    assert.ok(signal instanceof AbortSignal);
  }));
  const { controller, states } = harness({ provider });
  const p = controller.submit(SYNTHETIC_EMAIL);
  await Promise.resolve();
  controller.cancel();
  release();
  await p;
  assert.deepEqual(states.map((s) => s.name), ["loading", "idle"]);
});

test("provider rate limit penalises the gate, and the next attempt is blocked client-side", async () => {
  let calls = 0;
  let t = 0;
  const provider = configured(async () => { calls++; return unavailable({ reason: R.RATE_LIMITED, provider: INFO, retryAfterSeconds: 45 }); });
  const gate = createRateGate({ now: () => t });
  const { controller, states } = harness({ provider, gate });
  await controller.submit(SYNTHETIC_EMAIL);
  assert.equal(last(states).result.reason, R.RATE_LIMITED);
  t += 10_000;
  await controller.submit(SYNTHETIC_EMAIL);
  assert.equal(calls, 1);
  assert.equal(last(states).result.reason, R.CLIENT_RATE_LIMITED);
  assert.equal(last(states).result.retryAfterSeconds, 35);
});

test("a network error leaves no verdict on screen", async () => {
  const provider = configured(async () => unavailable({ reason: R.NETWORK_ERROR, provider: INFO }));
  const { controller, states } = harness({ provider });
  await controller.submit(SYNTHETIC_EMAIL);
  assert.equal(last(states).result.kind, RESULT_KIND.UNAVAILABLE);
});
