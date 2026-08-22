import { StrictMode, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider, createRouter } from "@tanstack/react-router"
import { XorgateProvider } from "@xorgate/react"

import "./index.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { getIdToken } from "@/lib/cognito"
import { useWorkspaceStore } from "@/store/workspace"
import { routeTree } from "./routeTree.gen"

const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

// First-party provider config: REST via the same origin the SDK client module
// uses, plus the four AWS fields that light up the live plane (Cognito
// identity pool + IoT MQTT-WSS + KVS). Omitting any of the four downgrades the
// live hooks to `unavailable` rather than crashing, so a partial .env behaves.
const XORGATE_CONFIG = {
  baseUrl: (import.meta.env.VITE_API_BASE_URL as string).replace(/\/$/, ""),
  region: import.meta.env.VITE_AWS_REGION as string,
  identityPoolId: import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID as string,
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID as string,
  realtimeEndpoint: import.meta.env.VITE_IOT_ENDPOINT as string,
}

const XORGATE_AUTH = { getIdToken }

// Tenancy flows from the workspace store into the provider, the same store
// lib/xorgate.ts reads for the imperative client — one source of truth, two
// consumers.
function XorgateRoot({ children }: { children: ReactNode }) {
  const organizationId = useWorkspaceStore((s) => s.currentOrganizationId)
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  return (
    <XorgateProvider
      config={XORGATE_CONFIG}
      auth={XORGATE_AUTH}
      organizationId={organizationId}
      workspaceId={workspaceId ?? undefined}
    >
      {children}
    </XorgateProvider>
  )
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
