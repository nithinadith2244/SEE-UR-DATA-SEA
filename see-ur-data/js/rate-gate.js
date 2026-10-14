// In-memory, per-page-load request limiter. It stores timestamps only (never
// email addresses) and nothing is persisted. It protects the visitor's own
// allowance with the provider and avoids accidental request floods; it is not a
// security control, because a client can always bypass client-side limits.

export function createRateGate({
  windows = [
    { limit: 5, ms: 60_000 },
    { limit: 20, ms: 3_600_000 },
  ],
  now = () => Date.now(),
} = {}) {
  const stamps = [];
  let cooldownUntil = 0;
  const maxMs = Math.max(...windows.map((w) => w.ms));

  return Object.freeze({
    /** @returns {{allowed:boolean, retryAfterSeconds:number}} */
    tryAcquire() {
      const t = now();
      while (stamps.length && t - stamps[0] >= maxMs) stamps.shift();

      if (t < cooldownUntil) {
        return { allowed: false, retryAfterSeconds: Math.ceil((cooldownUntil - t) / 1000) };
      }
      let waitMs = 0;
      for (const w of windows) {
        const inWindow = stamps.filter((s) => t - s < w.ms);
        if (inWindow.length >= w.limit) {
          const blocking = inWindow[inWindow.length - w.limit];
          waitMs = Math.max(waitMs, w.ms - (t - blocking));
        }
      }
      if (waitMs > 0) return { allowed: false, retryAfterSeconds: Math.ceil(waitMs / 1000) };

      stamps.push(t);
      return { allowed: true, retryAfterSeconds: 0 };
    },

    /** Called when the provider answers 429: back off for its Retry-After, or 60 s. */
    penalize(seconds) {
      const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
      cooldownUntil = Math.max(cooldownUntil, now() + s * 1000);
    },
  });
}
