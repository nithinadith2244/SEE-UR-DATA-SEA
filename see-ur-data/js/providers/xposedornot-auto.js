// Default free provider: XposedOrNot, no key.
//
//  1. Try the provider directly from the visitor's browser. Each visitor then
//     uses their OWN per-IP allowance (25/hour, 100/day on the free tier).
//  2. Only if that attempt fails at the network level (for example the browser
//     blocks it because the provider sends no CORS headers for this origin),
//     retry once through this site's own relay (/api/xon).
//
// Any other outcome (rate limit, provider error, malformed answer, a real
// result) is final and is NOT retried, so a limit is never evaded by switching
// route and no failure is ever turned into a verdict.

import { createXposedOrNotProvider, XON_INFO } from "./xposedornot.js";
import { RESULT_KIND, UNAVAILABLE_REASON as R } from "../result-model.js";

export function createXposedOrNotAutoProvider(deps = {}) {
  const direct = createXposedOrNotProvider({ ...deps, mode: "direct" });
  const relay = createXposedOrNotProvider({ ...deps, mode: "relay" });
  return Object.freeze({
    id: "xposedornot-auto",
    isConfigured: direct.isConfigured,
    info: XON_INFO,
    disclosure:
      "Each check sends the address you enter to XposedOrNot, a free breach-lookup service. Your browser asks it directly; if the browser cannot, this site's server asks on your behalf.",
    async lookup(email, opts = {}) {
      const first = await direct.lookup(email, opts);
      const failedToConnect = first.kind === RESULT_KIND.UNAVAILABLE && first.reason === R.NETWORK_ERROR;
      if (!failedToConnect || opts.signal?.aborted) return first;
      return relay.lookup(email, opts);
    },
  });
}
