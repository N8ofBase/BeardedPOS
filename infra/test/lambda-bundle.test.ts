import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const api = new URL("../../services/store-api/src/", import.meta.url);

describe("store Lambda bundle", () => {
  it("carries the offline catalog, since the bundle runs without the source folder", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "store-bundle-")), "index.mjs");
    await build({
      entryPoints: [new URL("square/snapshot.ts", api).pathname],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: out,
    });
    const { loadSnapshot } = (await import(pathToFileURL(out).href)) as {
      loadSnapshot: () => { items: unknown[] };
    };
    expect(loadSnapshot().items.length).toBeGreaterThan(0);
  });
});
