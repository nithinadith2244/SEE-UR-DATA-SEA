import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createController } from "../js/controller.js";
import { createRateGate } from "../js/rate-gate.js";
import { createXposedOrNotProvider } from "../js/providers/xposedornot.js";
import { createUnconfiguredProvider } from "../js/providers/unconfigured.js";
import { SYNTHETIC_EMAIL, fakeFetch, jsonResponse, foundBody, notFoundBody } from "./helpers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFile(join(root, p), "utf8");
async function jsFiles(dir = "js") {
  const out = [];
  for (const e of await readdir(join(root, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await jsFiles(p)));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const htmlFiles = async () => (await readdir(root)).filter((f) => f.endsWith(".html"));

test("source never logs: no console.*, debugger or alert in site code", async () => {
  for (const f of await jsFiles()) {
    assert.doesNotMatch(stripComments(await read(f)), /\bconsole\s*\.|\bdebugger\b|\balert\s*\(/, f);
  }
});

test("runtime logs nothing for any outcome and never echoes the address", async () => {
  const seen = [];
  const methods = ["log", "info", "warn", "error", "debug", "trace", "dir", "table"];
  const original = Object.fromEntries(methods.map((m) => [m, console[m]]));
  for (const m of methods) console[m] = (...a) => seen.push([m, a]);
  try {
    const bodies = [foundBody(), notFoundBody(), "garbage"];
    for (const body of bodies) {
      const provider = createXposedOrNotProvider({ fetchImpl: fakeFetch(() => jsonResponse(body)) });
      const c = createController({ provider, gate: createRateGate(), render() {} });
      await c.submit(SYNTHETIC_EMAIL);
    }
    const failing = createXposedOrNotProvider({ fetchImpl: fakeFetch(() => { throw new TypeError("x"); }) });
    await createController({ provider: failing, gate: createRateGate(), render() {} }).submit(SYNTHETIC_EMAIL);
    await createController({ provider: createUnconfiguredProvider(), gate: createRateGate(), render() {} }).submit(SYNTHETIC_EMAIL);
    await createController({ provider: failing, gate: createRateGate(), render() {} }).submit("bad input");
  } finally {
    Object.assign(console, original);
  }
  assert.deepEqual(seen, []);
});

test("no persistence, tracking or covert channels in site code", async () => {
  const banned = [
    /localStorage|sessionStorage|indexedDB|document\.cookie|caches\./,
    /sendBeacon|XMLHttpRequest|WebSocket|EventSource|navigator\.serviceWorker|importScripts/,
    /history\.(pushState|replaceState)|location\.(search|hash|href)\s*=/,
    /google-analytics|googletagmanager|gtag|hotjar|plausible|mixpanel|segment\.|fbq|clarity\.ms|matomo/i,
  ];
  for (const f of await jsFiles()) {
    const src = stripComments(await read(f));
    for (const re of banned) assert.doesNotMatch(src, re, `${f} matches ${re}`);
  }
});

test("no API keys, tokens or auth headers anywhere in site code or pages", async () => {
  const re = /api[_ -]?key|x-api-key|authorization|bearer|secret|token|password\s*[:=]/i;
  for (const f of await jsFiles()) assert.doesNotMatch(stripComments(await read(f)), re, f);
  for (const f of await htmlFiles()) {
    const html = (await read(f)).replace(/<!--[\s\S]*?-->/g, "");
    const visibleScriptsAndAttrs = html.match(/<(script|input|form)[^>]*>/gi) ?? [];
    for (const tag of visibleScriptsAndAttrs) assert.doesNotMatch(tag, re, `${f}: ${tag}`);
  }
});

test("browser code only fetches same-origin paths; external hosts appear only as attribution or in the optional adapter", async () => {
  for (const f of await jsFiles()) {
    const src = stripComments(await read(f));
    const hosts = [...new Set([...src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()))].sort();
    if (f === "js/providers/xposedornot.js") assert.deepEqual(hosts, ["api.xposedornot.com", "xposedornot.com"]);
    else if (f === "js/providers/hibp-server.js") assert.deepEqual(hosts, ["haveibeenpwned.com"], "attribution link only");
    else assert.deepEqual(hosts, [], `${f} references external hosts: ${hosts}`);
  }
  const hibp = stripComments(await read("js/providers/hibp-server.js"));
  assert.match(hibp, /checkPath = "\/api\/check"/);
  assert.match(hibp, /statusPath = "\/api\/status"/);
  assert.doesNotMatch(hibp, /fetchImpl\(\s*["'`]https?:/, "never fetches an absolute URL");
});

test("pages load nothing from other origins and have no inline code", async () => {
  for (const f of await htmlFiles()) {
    const html = await read(f);
    for (const m of html.matchAll(/\b(?:src|href|action)="([^"]*)"/g)) {
      assert.doesNotMatch(m[1], /^(?:https?:)?\/\//, `${f}: external reference ${m[1]}`);
    }
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${f}: inline script`);
    assert.doesNotMatch(html, /<style[\s>]/i, `${f}: inline style block`);
    assert.doesNotMatch(html, /\sstyle=/i, `${f}: inline style attribute`);
    assert.doesNotMatch(html, /\son[a-z]+=/i, `${f}: inline event handler`);
    assert.doesNotMatch(html, /<(iframe|object|embed|img|link rel="(?:preconnect|dns-prefetch|prefetch))/i, `${f}: embedded/third-party element`);
  }
  assert.doesNotMatch(await read("css/styles.css"), /@import|url\(\s*["']?(?:https?:)?\/\//i);
});

test("the email field has no name (so it can never be submitted in a URL) and no autofill", async () => {
  const html = await read("index.html");
  const input = html.match(/<input id="email"[^>]*>/)[0];
  assert.doesNotMatch(input, /\sname=/);
  assert.match(input, /autocomplete="off"/);
  assert.match(html, /<form id="check-form" novalidate/);
  assert.doesNotMatch(html.match(/<form[^>]*>/)[0], /\b(action|method)=/);
});

test("_headers ships a strict CSP and security headers; connect-src allows only self + the free provider", async () => {
  const h = await read("_headers");
  const csp = h.match(/Content-Security-Policy:\s*(.+)/)[1];
  const d = Object.fromEntries(csp.split(";").map((s) => s.trim()).filter(Boolean).map((s) => { const [k, ...v] = s.split(/\s+/); return [k, v]; }));
  assert.deepEqual(d["default-src"], ["'none'"]);
  assert.deepEqual(d["script-src"], ["'self'"]);
  assert.deepEqual(d["style-src"], ["'self'"]);
  assert.deepEqual(d["connect-src"], ["'self'", "https://api.xposedornot.com"], "exactly one third-party origin: the free provider");
  assert.deepEqual(d["frame-ancestors"], ["'none'"]);
  assert.deepEqual(d["form-action"], ["'none'"]);
  assert.deepEqual(d["base-uri"], ["'none'"]);
  assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(csp.replace("*", "")), "no unsafe sources or wildcards");
  assert.match(h, /Strict-Transport-Security:\s*max-age=\d{7,}/);
  assert.match(h, /X-Content-Type-Options:\s*nosniff/);
  assert.match(h, /Referrer-Policy:\s*no-referrer/);
  assert.match(h, /X-Frame-Options:\s*DENY/);
  assert.match(h, /Permissions-Policy:/);
});

test("privacy page statements match the shipped behaviour", async () => {
  const html = await read("privacy.html");
  assert.match(html, /sets no cookies/i);
  assert.match(html, /does not use local storage, session storage or IndexedDB/i);
  assert.match(html, /server-only/i);
  assert.match(html, /never in your browser/i);
});
