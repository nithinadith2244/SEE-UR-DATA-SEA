// Shared test helpers. All data here is SYNTHETIC: addresses use reserved
// example domains and breach records are invented purely as parser fixtures.
// They are never imported by site code.

export const SYNTHETIC_EMAIL = "synthetic.user@example.com";

export function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => h[String(k).toLowerCase()] ?? null },
    text: async () => text,
  };
}

/** Records every call. `responder` may return a response, a promise, or throw. */
export function fakeFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init, calls.length);
  };
  fn.calls = calls;
  return fn;
}

export const breachDetail = (over = {}) => ({
  breach: "ExampleBreach",
  details: "Synthetic fixture: a made-up breach used only to test the parser.",
  domain: "example.invalid",
  industry: "Testing",
  logo: "Example.png",
  password_risk: "hardtocrack",
  references: "https://example.com/report",
  searchable: "Yes",
  verified: "Yes",
  xposed_data: "Email addresses;Passwords;Usernames",
  xposed_date: "2015",
  xposed_records: 254967,
  ...over,
});

export const foundBody = (details = [breachDetail()]) => ({
  BreachMetrics: { risk: [{ risk_label: "Low", risk_score: 3 }] },
  BreachesSummary: { site: details.map((d) => d.breach).join(";") },
  ExposedBreaches: { breaches_details: details },
  ExposedPastes: null,
  PasteMetrics: null,
  PastesSummary: { cnt: 0, domain: "", tmpstmp: "" },
});

// The documented "not found" shape for /v1/breach-analytics.
export const notFoundBody = () => ({
  BreachMetrics: null,
  BreachesSummary: { site: "" },
  ExposedBreaches: null,
  ExposedPastes: null,
  PasteMetrics: null,
  PastesSummary: { cnt: 0, domain: "", tmpstmp: "" },
});
