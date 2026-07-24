// TEMPORARY Phase 3 verification harness (composite replays plan) — serves a
// bare page that mounts the PRODUCTION replay modules (timeline, clock, MSE
// tile, transport bar) against a spike-dumped manifest, for Playwright-driven
// checks without app auth. Delete this directory when Phase 3 lands.
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  // Phase 4: the telemetry hook's import graph reaches @/lib/api →
  // amazon-cognito-identity-js, which needs the same `global` shim the main
  // app config defines.
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../src"),
    },
  },
  server: {
    port: 5199,
    fs: { allow: [path.resolve(__dirname, "..")] },
  },
})
