// Zero-dependency Node server: serves the static site (with the headers from
// _headers) and the API routes. Used for local development, the integration
// test and any plain Node hosting. It does not log requests, URLs or bodies.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, handleCheck, handleStatus } from "./handler.js";
import { handleXonRelay } from "./xon-relay.js";

const defaultRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};
const PRIVATE_PREFIXES = [".", "tests", "node_modules", "server", "functions", "scripts", "docs", "package.json", "_headers", "README.md"];

async function globalHeaders(root) {
  const text = await readFile(join(root, "_headers"), "utf8");
  const out = {};
  let inGlobal = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) inGlobal = line.trim() === "/*";
    else if (inGlobal && line.includes(":")) {
      const i = line.indexOf(":");
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  delete out["Strict-Transport-Security"]; // meaningless on plain http://localhost
  return out;
}

function readBody(req, limit = 2048) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function clientIp(req, env) {
  if (env.TRUST_PROXY === "1") {
    const xff = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress ?? "unknown";
}

/**
 * @param {{env?:Record<string,string|undefined>, fetchImpl?:Function, baseUrl?:string, root?:string, timeoutMs?:number, limiter?:object}} opts
 */
export async function createAppServer({ env = process.env, fetchImpl, baseUrl, xonBaseUrl, root = defaultRoot, timeoutMs, limiter, globalLimiter } = {}) {
  const securityHeaders = await globalHeaders(root);
  const ctxBase = createContext({ fetchImpl, baseUrl, xonBaseUrl, timeoutMs, ...(limiter ? { limiter } : {}), ...(globalLimiter ? { globalLimiter } : {}) });

  return createServer(async (req, res) => {
    const send = (r) => {
      res.writeHead(r.status, { ...securityHeaders, ...r.headers });
      res.end(r.body);
    };
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      const ctx = { ...ctxBase, env };

      if (path === "/api/check" || path === "/api/status" || path === "/api/xon") {
        const bodyText = req.method === "POST" ? await readBody(req).catch(() => null) : "";
        const r = { method: req.method, headers: req.headers, bodyText: bodyText ?? "x".repeat(2048), ip: clientIp(req, env) };
        return send(path === "/api/check" ? await handleCheck(r, ctx) : path === "/api/xon" ? await handleXonRelay(r, ctx) : handleStatus(r, ctx));
      }

      if (req.method !== "GET" && req.method !== "HEAD") return send({ status: 405, headers: { allow: "GET, HEAD" }, body: "Method not allowed" });
      let file = normalize(join(root, decodeURIComponent(path === "/" ? "/index.html" : path)));
      if (file !== root && !file.startsWith(root + sep)) return send({ status: 403, headers: { "content-type": "text/plain" }, body: "Forbidden" });
      const rel = file.slice(root.length + 1);
      if (PRIVATE_PREFIXES.some((p) => rel === p || rel.startsWith(p + sep) || (p === "." && rel.startsWith(".")))) {
        return send({ status: 404, headers: { "content-type": "text/plain" }, body: "Not found" });
      }
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      return send({ status: 200, headers: { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }, body: req.method === "HEAD" ? "" : body });
    } catch {
      // Never echo error details: they could contain request data.
      send({ status: 404, headers: { "content-type": "text/plain" }, body: "Not found" });
    }
  });
}
