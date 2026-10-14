// DOM-free controller. Owns the state machine so it can be tested in Node:
//   idle -> invalid | loading -> result -> idle
//
// It never logs, never stores, and refuses to display anything that was not
// minted by result-model.js.

import { validateEmail } from "./email.js";
import { isGenuineResult, unavailable, UNAVAILABLE_REASON as R, RESULT_KIND } from "./result-model.js";

/**
 * @param {{provider:object, gate:{tryAcquire:Function,penalize:Function}, render:(state:object)=>void}} deps
 */
export function createController({ provider, gate, render }) {
  let inFlight = null;
  let seq = 0;

  function show(result) {
    // Last line of defence against fabricated or hand-built results.
    const safe = isGenuineResult(result) ? result : unavailable({ reason: R.INVALID_RESPONSE });
    render({ name: "result", result: safe });
  }

  async function submit(raw) {
    if (inFlight) return; // ignore double submits while a lookup is running

    const v = validateEmail(raw);
    if (!v.ok) {
      render({ name: "invalid", error: { code: v.code, message: v.message } });
      return;
    }

    if (!provider.isConfigured) {
      // No network, no gate usage, no verdict.
      show(await provider.lookup(v.email));
      return;
    }

    const slot = gate.tryAcquire();
    if (!slot.allowed) {
      show(unavailable({ reason: R.CLIENT_RATE_LIMITED, retryAfterSeconds: slot.retryAfterSeconds }));
      return;
    }

    const ac = new AbortController();
    const id = ++seq;
    inFlight = { id, ac };
    render({ name: "loading" });

    let result;
    try {
      result = await provider.lookup(v.email, { signal: ac.signal });
    } catch {
      result = unavailable({ reason: R.PROVIDER_ERROR });
    }

    if (!inFlight || inFlight.id !== id) return; // cancelled or superseded: drop silently
    inFlight = null;

    if (isGenuineResult(result) && result.kind === RESULT_KIND.UNAVAILABLE && result.reason === R.RATE_LIMITED) {
      gate.penalize(result.retryAfterSeconds);
    }
    show(result);
  }

  function cancel() {
    if (!inFlight) return;
    inFlight.ac.abort();
    inFlight = null;
    render({ name: "idle" });
  }

  function clear() {
    if (inFlight) {
      inFlight.ac.abort();
      inFlight = null;
    }
    render({ name: "idle" });
  }

  return Object.freeze({ submit, cancel, clear, isBusy: () => inFlight !== null });
}
