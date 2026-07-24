import { defineConfig } from "vitest/config"
import path from "node:path"

// Unit tests cover the pure replay logic (src/lib/replay) — node environment,
// no DOM. Browser-visual behavior is verified per the plan's user checklists.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
