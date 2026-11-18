import { defineConfig } from "vitest/config"
import path from "node:path"

// Unit tests cover the pure replay logic (src/lib/replay) — node environment,
// no DOM. Browser-visual behavior is verified per the plan's user checklists.
// A test that must render a component opts into jsdom with a
// `// @vitest-environment jsdom` docblock (e.g. provision-device-dialog.test.ts).
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
