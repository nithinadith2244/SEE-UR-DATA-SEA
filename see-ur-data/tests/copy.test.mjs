import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { toViewModel, formatRetry } from "../js/view-model.js";
import { confirmedBreach, noMatch, unavailable, UNAVAILABLE_REASON as R } from "../js/result-model.js";

const INFO = { id: "synthetic", name: "Synthetic Source", url: "https://example.com" };
const B = (o = {}) => ({ name: "ExampleBreach", verified: true, year: "2015", records: 1234567, exposedData: ["Email addresses"], ...o });

// Phrases that would wrongly reassure the reader about an unlisted or unavailable result.
const REASSURING = /\b(you('| a)re|is|are|it's|all)\s+(safe|secure|protected|clean|fine|ok(ay)?)\b|\ball clear\b|\bnothing to worry\b|\bno risk\b|\bnever (been )?(breached|exposed|leaked)\b.*\bconfirm/i;

function allText(vm) {
  return [vm.headline, vm.summary, ...vm.notes, ...vm.nextSteps, vm.retry ?? ""].join(" \n ");
}

test("'no match' never claims the address is safe and says so explicitly", () => {
  const vm = toViewModel(noMatch({ provider: INFO }));
  assert.equal(vm.tone, "clear");
  assert.doesNotMatch(allText(vm), REASSURING);
  assert.match(vm.notes.join(" "), /does not mean the address has never been exposed/i);
  assert.equal(vm.cards.length, 0);
});

test("every 'unavailable' reason has its own copy, says it is not a result, and does not imply an outcome", () => {
  const seen = new Set();
  for (const reason of Object.values(R)) {
    const vm = toViewModel(unavailable({ reason }));
    assert.equal(vm.tone, "unavailable", reason);
    assert.match(vm.notes.join(" "), /not a result|does not mean/i, reason);
    assert.doesNotMatch(allText(vm), REASSURING, reason);
    assert.ok(vm.headline.length > 10 && vm.summary.length > 20, reason);
    seen.add(vm.headline);
  }
  assert.equal(seen.size, Object.values(R).length, "headlines must be distinct");
});

test("unconfigured copy states nothing was sent and nothing was invented", () => {
  const vm = toViewModel(unavailable({ reason: R.PROVIDER_UNCONFIGURED }));
  assert.match(vm.summary, /nothing was sent/i);
  assert.match(vm.summary, /no result was made up/i);
  assert.equal(vm.source, null);
});

test("confirmed breach shows attribution, counts, and per-record verification", () => {
  const vm = toViewModel(
    confirmedBreach({ provider: INFO, breaches: [B(), B({ name: "Other", verified: false, records: null, year: null })] }),
  );
  assert.equal(vm.tone, "breach");
  assert.equal(vm.headline, "Listed in 2 documented breaches");
  assert.deepEqual(vm.source, { name: "Synthetic Source", url: "https://example.com/" });
  assert.match(vm.notes.join(" "), /1 of 2 records are marked verified/);
  assert.equal(vm.cards[0].verifiedLabel, "Verified by the source");
  assert.equal(vm.cards[1].verifiedLabel, "Not verified by the source");
  assert.ok(vm.cards[0].facts.some((f) => f.label === "Records exposed" && f.value === "1,234,567"));
  // Missing source data is omitted, not invented.
  assert.ok(!vm.cards[1].facts.some((f) => f.label === "Year of breach" || f.label === "Records exposed"));
  assert.ok(vm.nextSteps.length >= 3);
});

test("singular headline", () => {
  assert.equal(toViewModel(confirmedBreach({ provider: INFO, breaches: [B()] })).headline, "Listed in 1 documented breach");
});

test("unverified match is presented as inconclusive with its cards", () => {
  const vm = toViewModel(unavailable({ reason: R.UNVERIFIED_MATCH, provider: INFO, breaches: [B({ verified: false })] }));
  assert.equal(vm.tone, "unavailable");
  assert.match(vm.headline, /not verified/i);
  assert.equal(vm.cards.length, 1);
});

test("retry hints", () => {
  assert.equal(formatRetry(1), "Try again in about 1 second.");
  assert.equal(formatRetry(45), "Try again in about 45 seconds.");
  assert.equal(formatRetry(120), "Try again in about 2 minutes.");
  assert.equal(formatRetry(null), null);
  assert.equal(formatRetry(0), null);
});

test("hostile provider text stays inert data and the renderer never uses HTML parsing APIs", async () => {
  const vm = toViewModel(confirmedBreach({ provider: INFO, breaches: [B({ name: "<img src=x onerror=alert(1)>", description: "<script>alert(1)</script>" })] }));
  assert.equal(vm.cards[0].title, "<img src=x onerror=alert(1)>");
  const raw = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  const app = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"); // code only, comments stripped
  for (const banned of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function/, /setTimeout\s*\(\s*["'`]/, /DOMParser/, /createContextualFragment/]) {
    assert.doesNotMatch(app, banned);
  }
});
