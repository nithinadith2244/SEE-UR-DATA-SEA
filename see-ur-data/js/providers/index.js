// Provider registry. The UI only ever talks to the object returned here, which
// implements:
//   id: string
//   isConfigured: boolean
//   info: {id,name,url} | null      (attribution, null when unconfigured)
//   lookup(email, {signal}) -> Promise<result>   (results come from result-model.js)
//   status?() -> Promise<{state, mode}|null>     (optional, for the status banner)
//   disclosure?: string                          (privacy sentence shown beside the form)
//
// Unknown or empty provider ids fall back to the unconfigured provider, so a
// typo in config.js can never produce a result.

import { createUnconfiguredProvider } from "./unconfigured.js";
import { createXposedOrNotProvider } from "./xposedornot.js";
import { createXposedOrNotAutoProvider } from "./xposedornot-auto.js";
import { createHibpServerProvider } from "./hibp-server.js";

export function createProvider(config, deps = {}) {
  switch (config?.provider) {
    case "hibp-server":
      return createHibpServerProvider(deps);
    case "xposedornot-auto":
      return createXposedOrNotAutoProvider(deps);
    case "xposedornot":
      return createXposedOrNotProvider(deps);
    case "xposedornot-relay":
      return createXposedOrNotProvider({ ...deps, mode: "relay" });
    case "none":
    default:
      return createUnconfiguredProvider();
  }
}
