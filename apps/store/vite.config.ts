import react from "@vitejs/plugin-react";
import type { Connect, Plugin, ViteDevServer } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Runs the store server (services/store-api) inside `npm run dev:store`, so /api works locally with
 * an offline Square and a database saved in services/store-api/.data. Hosted, the same handlers run
 * in Lambda (step 5). Loaded once: the database can only be opened by one server at a time.
 */
function storeApi(): Plugin {
  let middleware: Promise<Connect.NextHandleFunction> | undefined;
  const load = (server: ViteDevServer) =>
    (middleware ??= server
      .ssrLoadModule("@bearded/store-api/node")
      .then((m) => m.apiMiddleware(m.devContext()) as Connect.NextHandleFunction));
  return {
    name: "bearded-store-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        load(server).then(
          (handle) => handle(req, res, next),
          (e: unknown) => next(e),
        );
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), storeApi()],
  server: { port: 5174 },
  build: { target: "es2023", sourcemap: true },
  test: {
    name: "store",
    environment: "happy-dom",
  },
});
