import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider, createRouter } from "@tanstack/react-router"

import "./index.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { XorgateRoot } from "@/components/xorgate-root"
import { AppLoadingScreen } from "@/components/app-loading-screen"
import { routeTree } from "./routeTree.gen"

// Route guards block in beforeLoad on /me (and the workspace bootstrap on
// /workspaces) before anything mounts, and a pending router renders nothing by
// default — that was the white screen on refresh. pendingMs 0 takes over from
// the index.html boot splash immediately; already-memoized guards resolve in
// microtasks, before even a 0ms timer fires, so client-side navigations don't
// flash it. minMs keeps the screen up long enough to not read as a flicker.
const router = createRouter({
  routeTree,
  defaultPendingComponent: AppLoadingScreen,
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
    <ThemeProvider>
      <TooltipProvider>
        <XorgateRoot>
          <RouterProvider router={router} />
        </XorgateRoot>
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
)
