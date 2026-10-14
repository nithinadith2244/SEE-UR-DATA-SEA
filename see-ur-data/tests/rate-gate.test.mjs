import test from "node:test";
import assert from "node:assert/strict";
import { createRateGate } from "../js/rate-gate.js";

test("allows up to the per-minute limit then reports when to retry", () => {
  let t = 1_000_000;
  const gate = createRateGate({ windows: [{ limit: 3, ms: 60_000 }], now: () => t });
  for (let i = 0; i < 3; i++) { assert.equal(gate.tryAcquire().allowed, true); t += 1000; }
  const blocked = gate.tryAcquire();
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 57); // oldest request is 3 s old
  t += 57_000;
  assert.equal(gate.tryAcquire().allowed, true);
});

test("enforces the hourly window independently of the minute window", () => {
  let t = 0;
  const gate = createRateGate({ windows: [{ limit: 5, ms: 60_000 }, { limit: 2, ms: 3_600_000 }], now: () => t });
  assert.equal(gate.tryAcquire().allowed, true);
  t += 61_000;
  assert.equal(gate.tryAcquire().allowed, true);
  t += 61_000;
  const r = gate.tryAcquire();
  assert.equal(r.allowed, false);
  assert.ok(r.retryAfterSeconds > 3000);
});

test("penalize applies a cooldown, defaulting to 60 s without a hint", () => {
  let t = 0;
  const gate = createRateGate({ now: () => t });
  gate.penalize(null);
  assert.deepEqual(gate.tryAcquire(), { allowed: false, retryAfterSeconds: 60 });
  t += 60_000;
  assert.equal(gate.tryAcquire().allowed, true);
  gate.penalize(120);
  t += 1000;
  assert.equal(gate.tryAcquire().retryAfterSeconds, 119);
});

test("blocked attempts do not consume allowance", () => {
  let t = 0;
  const gate = createRateGate({ windows: [{ limit: 1, ms: 10_000 }], now: () => t });
  assert.equal(gate.tryAcquire().allowed, true);
  for (let i = 0; i < 20; i++) assert.equal(gate.tryAcquire().allowed, false);
  t += 10_000;
  assert.equal(gate.tryAcquire().allowed, true);
});
