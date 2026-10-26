import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/core",
      "packages/db",
      "services/api",
      "apps/web",
      "apps/store",
      "packages/store-core",
      "services/store-api",
      "infra",
    ],
  },
});
