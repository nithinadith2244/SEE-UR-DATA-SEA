// Cloudflare Pages Function: POST /api/xon (relay for the free XposedOrNot API; needs no key)
// Set XON_RELAY=off in the Pages project to disable it.
import { createContext } from "../../server/handler.js";
import { handleXonRelay } from "../../server/xon-relay.js";

const shared = createContext(); // per-isolate and best effort; add a Cloudflare rate-limiting rule too

export async function onRequest({ request, env }) {
  const headers = Object.fromEntries(request.headers);
  const bodyText = request.method === "POST" ? await request.text() : "";
  const r = await handleXonRelay(
    { method: request.method, headers, bodyText, ip: headers["cf-connecting-ip"] ?? "unknown" },
    { ...shared, env },
  );
  return new Response(r.body, { status: r.status, headers: r.headers });
}
