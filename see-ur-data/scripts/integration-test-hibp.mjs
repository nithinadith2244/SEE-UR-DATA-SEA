// Controlled integration test against the REAL Have I Been Pwned API, using only
// HIBP's documented test key and test accounts (domain hibp-integration-tests.com).
//
//   npm run test:integration
//
// What it does:
//  1. Starts this project's real server in TEST MODE in-process, with a clean
//     environment (a production HIBP_API_KEY in your shell is deliberately ignored).
//  2. Calls POST /api/check for account-exists@hibp-integration-tests.com
//     (documented: returns one breach) and prints the observed HTTP statuses.
//  3. Passes the real envelope through the same browser-side code that renders
//     results, and prints what the user would see.
//  4. Calls the documented no-breach test account (opt-out@...) to observe a
//     genuine HTTP 404 being classified as "not found".
//  5. Checks that test mode refuses a real-looking address and that the key is
//     never present in any response.
//
// Exit codes: 0 = all checks passed, 1 = reached HIBP but something was wrong,
//             2 = INCONCLUSIVE: HIBP could not be reached (no verdict is claimed).
// Output never contains the API key.

import { createAppServer } from "../server/app-server.mjs";
import { HIBP_TEST_API_KEY } from "../server/hibp.js";
import { interpretEnvelope } from "../js/providers/hibp-server.js";
import { toViewModel } from "../js/view-model.js";

const ACCOUNT_EXISTS = "account-exists@hibp-integration-tests.com";
const NO_BREACH = "opt-out@hibp-integration-tests.com";
const REAL_LOOKING = "synthetic.user@example.com";

const out = (s = "") => process.stdout.write(`${s}\n`);
const results = [];
let reachedHibp = false;
// live=true marks checks that need a real HIBP answer; they are SKIPPED (not failed) when HIBP was unreachable.
const check = (name, ok, detail = "", live = false) => {
  if (live && !reachedHibp) {
    out(`  [SKIP] ${name} - HIBP not reached`);
    return;
  }
  results.push({ name, ok });
  out(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` - ${detail}` : ""}`);
};

// Clean env on purpose: test mode must never see (or use) a production key.
const server = await createAppServer({ env: { HIBP_MODE: "test" } });
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;

async function call(email) {
  const res = await fetch(`${origin}/api/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* leave null */
  }
  if (body && typeof body.upstreamStatus === "number") reachedHibp = true;
  if (text.includes(HIBP_TEST_API_KEY)) check("response does not contain the API key", false);
  return { httpStatus: res.status, body, text };
}

out("SEE UR DATA - HIBP integration test (TEST MODE, official test accounts only)");
out(`Target: https://haveibeenpwned.com/api/v3/breachedaccount/{account}  (key: documented test key, hidden)`);
out("");

try {
  const status = await (await fetch(`${origin}/api/status`)).json();
  out(`Server status: ${JSON.stringify(status)}`);
  check("server is in test mode", status.state === "ready" && status.mode === "test");
  out("");

  out(`1. ${ACCOUNT_EXISTS}  (documented: one breach, one paste)`);
  const a = await call(ACCOUNT_EXISTS);
  out(`   Our server HTTP status : ${a.httpStatus}`);
  out(`   HIBP upstream status   : ${a.body?.upstreamStatus ?? "none (HIBP was not reached)"}`);
  out(`   Envelope state         : ${a.body?.state}${a.body?.errorKind ? ` / ${a.body.errorKind}` : ""}`);
  if (a.body?.state === "breached") {
    out(`   Breaches returned      : ${a.body.breaches.length}`);
    for (const b of a.body.breaches) {
      out(`     - ${b.title} (${b.name}) year=${b.year ?? "n/a"} verified=${b.verified} data=[${b.exposedData.join(", ")}]`);
    }
  }
  check("HIBP answered HTTP 200", a.body?.upstreamStatus === 200, `observed ${a.body?.upstreamStatus ?? "none"}`, true);
  check("server envelope is 'breached' with at least one breach", a.body?.state === "breached" && a.body.breaches?.length >= 1, "", true);
  check("documented count: exactly one breach", a.body?.breaches?.length === 1, `observed ${a.body?.breaches?.length ?? 0}`, true);

  if (a.body) {
    const r = interpretEnvelope(a.httpStatus, a.body);
    const vm = toViewModel(r);
    out("   As displayed to the user:");
    out(`     headline : ${vm.headline}`);
    out(`     summary  : ${vm.summary}`);
    for (const n of vm.notes) out(`     note     : ${n}`);
    for (const c of vm.cards) out(`     card     : ${c.title} [${c.verifiedLabel}] ${c.facts.map((f) => `${f.label}=${f.value}`).join("; ")}`);
    check("browser code classifies it as a confirmed breach (test-mode labelled)", r.kind === "confirmed_breach" && r.testMode === true && /^Test mode: /.test(vm.headline), "", true);
  }
  out("");

  out(`2. ${NO_BREACH}  (documented: no breaches)`);
  const n = await call(NO_BREACH);
  out(`   Our server HTTP status : ${n.httpStatus}`);
  out(`   HIBP upstream status   : ${n.body?.upstreamStatus ?? "none (HIBP was not reached)"}`);
  out(`   Envelope state         : ${n.body?.state}${n.body?.errorKind ? ` / ${n.body.errorKind}` : ""}`);
  check("genuine HTTP 404 observed and classified as not_found", n.body?.upstreamStatus === 404 && n.body?.state === "not_found", `observed ${n.body?.upstreamStatus ?? "none"}`, true);
  if (n.body) {
    const vm = toViewModel(interpretEnvelope(n.httpStatus, n.body));
    out(`   As displayed: ${vm.headline}`);
  }
  out("");

  out("3. Safety checks");
  const real = await call(REAL_LOOKING);
  check("test mode refuses a real-looking address (no lookup, no test data shown)", real.httpStatus === 400 && real.body?.code === "test_mode_domain_only" && !("breaches" in (real.body ?? {})));
  const all = [a.text, n.text, real.text].join("\n");
  check("API key never appears in any response", !all.includes(HIBP_TEST_API_KEY));
} finally {
  server.close();
}

out("");
const failed = results.filter((r) => !r.ok);
if (!reachedHibp) {
  out("RESULT: INCONCLUSIVE (exit 2). HIBP could not be reached from this machine, so no HTTP status was observed from HIBP");
  out("and nothing about the integration can be claimed. Network/DNS access to haveibeenpwned.com is required.");
  process.exit(2);
}
out(failed.length ? `RESULT: FAILED (exit 1): ${failed.length} check(s) did not pass.` : "RESULT: PASSED (exit 0): all checks passed against the live HIBP test accounts.");
process.exit(failed.length ? 1 : 0);
