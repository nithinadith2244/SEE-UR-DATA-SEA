// Verifies that every local href/src in the HTML pages points at an existing file.
import { readdir, readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pages = (await readdir(root)).filter((f) => f.endsWith(".html"));
let bad = 0;
for (const page of pages) {
  const html = await readFile(join(root, page), "utf8");
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    try {
      await access(join(root, target.split("#")[0]));
    } catch {
      console.error(`BROKEN: ${page} -> ${target}`);
      bad++;
    }
  }
}
if (bad) process.exit(1);
console.log(`Checked ${pages.length} pages: all local links resolve.`);
