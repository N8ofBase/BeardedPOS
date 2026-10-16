// Copies docs/prototype.html into infra/.site/index.html so the DemoSite stack can upload it.
// Session 1a replaces this with the React demo build.
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const infraDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = join(infraDir, ".site");

rmSync(siteDir, { recursive: true, force: true });
mkdirSync(siteDir, { recursive: true });
copyFileSync(join(infraDir, "..", "docs", "prototype.html"), join(siteDir, "index.html"));
console.log(`Staged prototype at ${siteDir}`);
