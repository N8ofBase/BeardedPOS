import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

const PROTOTYPE = fileURLToPath(new URL("../../docs/prototype.html", import.meta.url));

/** Serves docs/prototype.html at /prototype.html (dev) and ships it in the build, without a second copy in the repo. */
function prototypePage(): Plugin {
  return {
    name: "prototype-page",
    configureServer(server) {
      server.middlewares.use("/prototype.html", (_req, res) => {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(readFileSync(PROTOTYPE));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "prototype.html", source: readFileSync(PROTOTYPE) });
    },
  };
}

// `vite build --mode hosted` makes the register for the store's site at /register (see .env.hosted).
export default defineConfig(({ mode }) => {
  const hosted = mode === "hosted";
  const base = hosted ? "/register/" : "/";
  return {
    base,
    plugins: [
      react(),
      ...(hosted ? [] : [prototypePage()]),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icon.svg"],
        manifest: {
          name: "Bearded POS",
          short_name: "Bearded POS",
          description: "Register, inventory and customers for the store.",
          theme_color: "#0f6e5a",
          background_color: "#f3f5f4",
          display: "standalone",
          orientation: "any",
          start_url: base,
          scope: base,
          icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
        },
        workbox: {
          // PGlite's WebAssembly and data files are large; precache them so the counter works offline.
          globPatterns: ["**/*.{js,css,html,svg,wasm,data,gz}"],
          maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
          navigateFallback: `${base}index.html`,
          navigateFallbackDenylist: [/^\/prototype\.html$/, /^\/api\//],
        },
      }),
    ],
    // PGlite ships its own WebAssembly; Vite's pre-bundling breaks its asset paths.
    optimizeDeps: { exclude: ["@electric-sql/pglite"] },
    worker: { format: "es" },
    build: { target: "es2023", sourcemap: true, outDir: hosted ? "dist-hosted" : "dist" },
    test: {
      name: "web",
      environment: "happy-dom",
    },
  };
});
