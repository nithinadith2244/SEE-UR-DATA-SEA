// Static accessibility and responsiveness checks. These are fast proxies that
// run anywhere with Node. They do NOT replace a real browser audit; the manual
// checklist in docs/TESTING.md covers screen readers, zoom and device testing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFile(join(root, p), "utf8");
const pages = (await readdir(root)).filter((f) => f.endsWith(".html")).sort();
const css = await read("css/styles.css");

function tokens() {
  const block = css.match(/:root\s*\{([\s\S]*?)\}/)[1];
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test("text colour pairs meet WCAG AA (most meet AAA)", () => {
  const t = tokens();
  const panelEnd = "#0a1528"; // second stop of the .console gradient
  const checks = [
    ["text", "navy", 7], ["text", "ink", 7], ["text", "panel", 7],
    ["muted", "navy", 4.5], ["muted", "ink", 4.5], ["muted", "panel", 4.5],
    ["cyan", "navy", 4.5], ["cyan", "ink", 4.5], ["cyan", "panel", 4.5],
    ["amber", "navy", 4.5], ["amber", "panel", 4.5], ["amber", "ink", 4.5],
    ["slate", "navy", 4.5], ["slate", "panel", 4.5],
    ["on-cyan", "cyan", 4.5],
  ];
  for (const [fg, bg, min] of checks) {
    const r = ratio(t[fg], t[bg]);
    assert.ok(r >= min, `${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min}:1`);
  }
  assert.ok(ratio(t["muted"], panelEnd) >= 4.5);
  assert.ok(ratio(t["on-cyan"], "#6fe3f8") >= 4.5, "primary button hover state");
});

test("input and button boundaries meet 3:1 non-text contrast", () => {
  const t = tokens();
  for (const bg of ["ink", "panel", "navy"]) {
    const r = ratio(t["control-edge"], t[bg]);
    assert.ok(r >= 3, `control-edge on ${bg} is ${r.toFixed(2)}:1`);
  }
});

test("every page has the structure assistive technology needs", async () => {
  const titles = new Set();
  for (const f of pages) {
    const html = await read(f);
    assert.match(html, /^<!doctype html>/i, f);
    assert.match(html, /<html lang="en">/, `${f}: lang`);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1[^"]*">/, `${f}: viewport`);
    assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale/i, `${f}: zoom must not be disabled`);
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    assert.ok(title && title.length > 5, `${f}: title`);
    assert.ok(!titles.has(title), `${f}: duplicate title`);
    titles.add(title);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `${f}: exactly one h1`);
    assert.equal((html.match(/<main[\s>]/g) ?? []).length, 1, `${f}: one main`);
    assert.match(html, /<header class="site-header">/, f);
    assert.match(html, /<footer class="site-footer">/, f);
    assert.match(html, /<nav aria-label="Main">/, f);
    assert.match(html, /<nav aria-label="Footer">/, f);
    // Skip link is the first focusable element and its target exists.
    const firstFocusable = html.match(/<(a|button|input|select|textarea)\b[^>]*>/)[0];
    assert.match(firstFocusable, /class="skip-link" href="#main"/, `${f}: skip link first`);
    assert.match(html, /<main id="main" tabindex="-1">/, f);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1, `${f}: one aria-current in main nav`);
    assert.match(html, new RegExp(`<a href="${f}" aria-current="page">`), `${f}: current page marked`);
  }
});

test("ids are unique and every aria reference resolves", async () => {
  for (const f of pages) {
    const html = await read(f);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${f}: duplicate ids`);
    for (const m of html.matchAll(/aria-(?:labelledby|describedby)="([^"]+)"/g)) {
      for (const id of m[1].split(/\s+/)) assert.ok(ids.includes(id), `${f}: dangling aria reference #${id}`);
    }
    for (const m of html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)) assert.ok(ids.includes(m[1]), `${f}: label for=${m[1]}`);
  }
});

test("heading levels never skip downward", async () => {
  for (const f of pages) {
    const html = await read(f);
    let prev = 0;
    for (const m of html.matchAll(/<h([1-6])[\s>]/g)) {
      const level = Number(m[1]);
      assert.ok(prev === 0 || level <= prev + 1, `${f}: h${prev} -> h${level}`);
      prev = level;
    }
  }
});

test("search form: labelled input, announced errors, named buttons, live results region", async () => {
  const html = await read("index.html");
  assert.match(html, /<label class="field-label" for="email">/);
  assert.match(html, /<input id="email"[^>]*aria-describedby="email-hint email-error"/);
  assert.match(html, /<input id="email" type="email"[^>]*inputmode="email"/);
  assert.match(html, /<p id="email-error"[^>]*role="alert"[^>]*hidden>/);
  assert.match(html, /id="results"[^>]*aria-live="polite"[^>]*aria-busy="false"/);
  assert.match(html, /<h2 id="results-label" class="visually-hidden">/);
  for (const m of html.matchAll(/<button\b[^>]*>([^<]*)<\/button>/g)) assert.ok(m[1].trim().length > 0, "button needs visible text");
  assert.match(html, /<noscript>/);
});

test("dynamic UI wiring covers loading, error, empty and result states with focus management", async () => {
  const app = await read("js/app.js");
  for (const needle of ['role: "status"', 'aria-invalid', "aria-busy", "heading.focus", "input.focus()", '"No search yet"', 'tabindex: "-1"']) {
    assert.ok(app.includes(needle), `app.js should contain ${needle}`);
  }
});

test("links that open a new tab are protected and announce nothing misleading", async () => {
  const app = await read("js/app.js");
  assert.match(app, /target: "_blank", rel: "noopener noreferrer nofollow external"/);
  for (const f of pages) assert.doesNotMatch(await read(f), /target="_blank"(?![^>]*noopener)/, f);
});

test("CSS: visible focus, reduced motion, high-contrast support and touch targets", () => {
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*3px solid/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none !important/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /\.skip-link:focus\s*\{[^}]*top:\s*0\.75rem/);
  // Outline may only be removed from a :focus rule that has a matching :focus-visible ring
  // (used for the programmatically focused result heading).
  for (const m of css.matchAll(/([^{}]+)\{[^}]*outline:\s*(?:none|0)\s*;[^}]*\}/g)) {
    const selector = m[1].trim();
    assert.match(selector, /:focus$/, `outline removed from non-:focus selector: ${selector}`);
    assert.ok(css.includes(`${selector}-visible`), `${selector} needs a :focus-visible replacement`);
  }
  for (const sel of [/\.btn\s*\{[^}]*min-height:\s*48px/, /\.nav a\s*\{[^}]*min-height:\s*44px/, /input\[type="email"\][^{]*\{[^}]*min-height:\s*48px/, /\.brand\s*\{[^}]*min-height:\s*44px/]) {
    assert.match(css, sel);
  }
});

test("CSS is mobile-first and cannot force horizontal scrolling", () => {
  const queries = [...css.matchAll(/@media\s*\(([^)]+)\)/g)].map((m) => m[1]);
  const layout = queries.filter((q) => /width/.test(q));
  assert.ok(layout.length >= 2);
  for (const q of layout) assert.match(q, /^min-width:/, `layout query must be min-width: ${q}`);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /\.doc \.table-scroll\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(css, /img,\s*svg\s*\{[^}]*max-width:\s*100%/);
  assert.doesNotMatch(css, /(?<!min-|max-)width:\s*\d{3,}px/, "no wide fixed pixel widths");
  const methodology = readFile(join(root, "methodology.html"), "utf8");
  return methodology.then((h) => assert.match(h, /<div class="table-scroll">/));
});

test("colour is never the only signal: states carry text labels", async () => {
  const index = await read("index.html");
  for (const label of ["Listed in a documented breach", "0 known breaches found", "Unavailable or inconclusive"]) assert.ok(index.includes(label));
  const app = await read("js/app.js");
  assert.match(app, /card\.verifiedLabel/);
});
