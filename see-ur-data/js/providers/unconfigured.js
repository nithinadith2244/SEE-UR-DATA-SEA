// Default provider. It exists so the UI has one honest code path when no
// eligible breach-data provider has been configured: it makes NO network
// request and can only ever answer "unavailable".

import { unavailable, UNAVAILABLE_REASON } from "../result-model.js";

export function createUnconfiguredProvider() {
  return Object.freeze({
    id: "none",
    isConfigured: false,
    info: null,
    async lookup() {
      return unavailable({ reason: UNAVAILABLE_REASON.PROVIDER_UNCONFIGURED });
    },
  });
}
