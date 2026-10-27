// @vitest-environment node
// The hosted build must carry the email sign-in app, not the browser demo. (A first deploy shipped
// the demo because the switch lived in a .env file that git ignores.)
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("hosted build", () => {
  it("ships the email sign-in register under /register, without the demo", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "register-build-"));
    await build({ root, mode: "hosted", logLevel: "silent", build: { outDir, sourcemap: false } });
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    expect(html).toContain('src="/register/assets/');
    const js = readdirSync(join(outDir, "assets"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(outDir, "assets", f), "utf8"))
      .join("\n");
    expect(js).toContain("Sign in to the register");
    expect(js).not.toContain("Setting up the demo register");
  }, 120_000);
});
