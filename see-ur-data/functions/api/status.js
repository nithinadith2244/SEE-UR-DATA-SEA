// Cloudflare Pages Function: GET /api/status (reports mode and whether a key is configured; never the key)
import { createContext, handleStatus } from "../../server/handler.js";

const shared = createContext();

export async function onRequest({ request, env }) {
  const r = handleStatus({ method: request.method, headers: Object.fromEntries(request.headers), bodyText: "", ip: "" }, { ...shared, env });
  return new Response(r.body, { status: r.status, headers: r.headers });
}
