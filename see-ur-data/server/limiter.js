// Per-client sliding-window limiter, memory only. Keys are client IPs; email
// addresses are never stored. On serverless platforms each instance has its own
// memory, so treat this as best effort and add a platform rate-limit rule too.

export function createIpLimiter({ limit = 10, windowMs = 60_000, maxKeys = 10_000, now = () => Date.now() } = {}) {
  const hits = new Map();
  return Object.freeze({
    /** @returns {{allowed:boolean, retryAfterSeconds:number}} */
    check(key) {
      const t = now();
      if (hits.size > maxKeys) {
        for (const [k, v] of hits) if (!v.some((s) => t - s < windowMs)) hits.delete(k);
        if (hits.size > maxKeys) hits.clear(); // fail open on pathological key counts rather than grow forever
      }
      const recent = (hits.get(key) ?? []).filter((s) => t - s < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (t - recent[0])) / 1000)) };
      }
      recent.push(t);
      hits.set(key, recent);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  });
}
