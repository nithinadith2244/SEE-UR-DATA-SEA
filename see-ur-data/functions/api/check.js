// Cloudflare Pages Function: POST /api/check
// Set HIBP_API_KEY as an encrypted environment variable (secret) in the Pages
// project. It is only ever read here, on the server.
import { createContext, handleCheck, jsonResponse } from "../../server/handler.js";

const shared = createContext(); // per-isolate, best-effort limiter; also add a Cloudflare rate-limiting rule

export async function onRequest({ request, env }) {
  const headers = Object.fromEntries(request.headers);
  const bodyText = request.method === "POST" ? await request.text() : "";
  const r = await handleCheck(
    { method: request.method, headers, bodyText, ip: headers["cf-connecting-ip"] ?? "unknown" },
    { ...shared, env },
  );
  return new Response(r.body, { status: r.status, headers: r.headers });
}
