// Guards against text saved with the wrong encoding (UTF-8 read as Windows-1252 and
// written back), which turns "·" into "Â·" on screen.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const DIRS = [
  "apps/web/src",
  "packages/core/src",
  "packages/db/src",
  "packages/db/seed",
  "packages/db/migrations",
  "services/api/src",
];
const MOJIBAKE = /Ã.|Â[^\s\w]|â€/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|sql|css)$/.test(name) ? [p] : [];
  });
}

describe("source encoding", () => {
  it("has no double-encoded characters", () => {
    const bad = DIRS.flatMap((d) => files(join(root, d))).filter((f) =>
      MOJIBAKE.test(readFileSync(f, "utf8")),
    );
    expect(bad).toEqual([]);
  });
});
