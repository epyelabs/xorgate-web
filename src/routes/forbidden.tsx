import { createFileRoute } from "@tanstack/react-router"
import { ForbiddenScreen } from "@/components/error-screens"

// A standalone home for the 403 screen. Pages that gate on a permission render
// ForbiddenScreen in place (keeping their own URL); this route exists for the
// cases with no page to stay on — a link handed to someone who can't open it,
// or a future backend 403 that needs somewhere to land.
export const Route = createFileRoute("/forbidden")({
  component: ForbiddenScreen,
})
