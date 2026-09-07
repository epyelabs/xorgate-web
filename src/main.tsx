import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createRouter } from "@tanstack/react-router"
import { QueryClientProvider } from "@tanstack/react-query"

import "./index.css"
import { queryClient } from "@/lib/query-client"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { XorgateRoot } from "@/components/xorgate-root"
import { RoutePendingScreen } from "@/components/app-loading-screen"
import { AppRouter } from "@/components/app-router"
import { routeTree } from "./routeTree.gen"

// Route guards block in beforeLoad on /me (and the workspace bootstrap on
// /workspaces) before anything mounts, and a pending router renders nothing by
// default — that was the white screen on refresh. pendingMs 0 takes over from
// the index.html boot splash immediately; minMs keeps the screen up long enough
// to not read as a flicker.
//
// RoutePendingScreen — not AppLoadingScreen — because this component also
// renders for every LATER transition, and by then it renders inside the app
// shell's content area rather than over the viewport. It shows the brand hold
// only until the shell exists, and a quiet inline hold after that.
const router = createRouter({
  routeTree,
  defaultPendingComponent: RoutePendingScreen,
  defaultPendingMs: 0,
  defaultPendingMinMs: 300,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* The query cache sits ABOVE the router so it survives every navigation:
        a tab switch or back-navigation renders straight out of the cache
        instead of refetching behind a spinner. */}
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <XorgateRoot>
            <AppRouter router={router} />
          </XorgateRoot>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
)
