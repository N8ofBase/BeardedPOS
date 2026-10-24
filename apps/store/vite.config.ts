import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  build: { target: "es2023", sourcemap: true },
  test: {
    name: "store",
    environment: "happy-dom",
  },
});
