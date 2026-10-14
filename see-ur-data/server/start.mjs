// Starts the Node server.  Usage:
//   npm run dev                 production mode: needs HIBP_API_KEY in the environment
//   npm run dev:test            test mode: official HIBP test account only, never uses HIBP_API_KEY
import { createAppServer } from "./app-server.mjs";
import { resolveConfig } from "./hibp.js";

const env = { ...process.env };
if (process.argv.includes("--test-mode")) env.HIBP_MODE = "test";

const port = Number(env.PORT) || 8080;
const host = env.HOST || "127.0.0.1";
const server = await createAppServer({ env });
server.listen(port, host, () => {
  const cfg = resolveConfig(env);
  // Mode only. The key, requests and addresses are never printed.
  const line = cfg.state === "ready" ? `mode=${cfg.mode}` : `NOT CONFIGURED (${cfg.reason}); lookups will say "Live email breach lookup is not configured yet."`;
  process.stdout.write(`SEE UR DATA on http://${host}:${port}  ${line}\n`);
});
