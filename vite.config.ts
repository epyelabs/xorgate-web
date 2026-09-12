import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { TanStackRouterVite } from "@tanstack/router-plugin/vite"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    global: "globalThis",
  },
  optimizeDeps: {
    // maplibre-gl ships its tile-loading web worker as a separate entry that
    // the dep optimizer drops, which leaves the map alive but silently unable
    // to fetch a single tile. Excluding it keeps the worker resolvable.
    exclude: ["maplibre-gl"],
  },
})
