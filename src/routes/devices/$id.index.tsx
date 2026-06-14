import { createFileRoute, redirect } from "@tanstack/react-router"

// The canonical device URL has no view of its own — Live Telemetry is the
// default tab, so redirect straight to it. `replace` keeps /devices/$id out of
// history and avoids a back-button bounce.
export const Route = createFileRoute("/devices/$id/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/devices/$id/live",
      params: { id: params.id },
      replace: true,
    })
  },
})
