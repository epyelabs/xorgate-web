import type { ReactNode } from "react"
import { Link, useLocation, useRouter } from "@tanstack/react-router"
import {
  ArrowLeftIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  Snail,
  TriangleAlertIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/store/auth"
import { xgMessage } from "@/lib/xorgate"
import {
  ROLE_LABEL,
  rolesWithPermission,
  useCurrentRole,
  type Permission,
} from "@/lib/permissions"
import { DEFAULT_AUTHED_ROUTE } from "@/lib/auth-guard"

// The screens render in two very different frames: as the whole page for
// signed-out visitors, and inside the app shell — below the 4rem header, to the
// right of the sidebar — for signed-in ones.
const SHELL_BASE =
  "flex flex-1 flex-col items-center justify-center p-6 text-center"

// The content sits in a panel of its own so it reads as a contained object on
// the empty page rather than text floating in the middle of it. Same border and
// shadow weight as the app's other panels.
const CARD =
  "flex w-full max-w-md flex-col items-center gap-5 rounded-lg border bg-card px-6 py-8 shadow-sm"

const STANDALONE = "min-h-svh"

// Centered on the track the user actually sees — the area beside the sidebar
// and below the header — which is where the eye reads the middle, not the
// middle of the raw viewport. Filling exactly the height under the header gets
// that for free without pushing the page into a scrollbar; the header is 1rem
// shorter once the sidebar collapses to its icon rail.
const IN_SHELL = [
  "min-h-[calc(100svh-4rem)]",
  "group-has-data-[collapsible=icon]/sidebar-wrapper:min-h-[calc(100svh-3rem)]",
].join(" ")

/**
 * The shared frame for a whole-page state: one panel, centered on the track the
 * user is actually looking at. Exported because the non-error states that take
 * over a page too — /no-workspace — have to sit in the same frame, and a second
 * copy of these class strings would drift from this one.
 *
 * `code` is optional: the 404/403 screens name their status, a state that has
 * no HTTP status of its own simply omits it.
 */
export function StatusScreen({
  icon,
  code,
  title,
  description,
  detail,
  actions,
}: {
  icon: ReactNode
  code?: string
  title: string
  description: ReactNode
  detail?: ReactNode
  actions: ReactNode
}) {
  // RootLayout draws the shell only for signed-in users, so this is also the
  // test for which frame the screen is rendering into.
  const inShell = useAuthStore((s) => s.isAuthenticated)

  return (
    <div className={cn(SHELL_BASE, inShell ? IN_SHELL : STANDALONE)}>
      <div className={CARD}>
        <div className="flex flex-col items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
            {icon}
          </div>
          <div className="flex flex-col items-center gap-1">
            {code ? (
              <span className="font-mono text-xs tracking-widest text-muted-foreground">
                {code}
              </span>
            ) : null}
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          </div>
          <p className="text-xs/relaxed text-muted-foreground">{description}</p>
        </div>
        {detail}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {actions}
        </div>
      </div>
    </div>
  )
}

function BackButton() {
  const router = useRouter()
  return (
    <Button variant="outline" onClick={() => router.history.back()}>
      <ArrowLeftIcon data-icon="inline-start" />
      Go back
    </Button>
  )
}

// Signed-out visitors have nowhere useful to go inside the app, so their only
// onward action is the login page.
function HomeAction({ isAuthenticated }: { isAuthenticated: boolean }) {
  return isAuthenticated ? (
    <Button asChild>
      <Link to={DEFAULT_AUTHED_ROUTE}>Go to Devices</Link>
    </Button>
  ) : (
    <Button asChild>
      <Link to="/login">Go to sign in</Link>
    </Button>
  )
}

export function NotFoundScreen() {
  const location = useLocation()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  return (
    <StatusScreen
      icon={<Snail />}
      code="404"
      title="Page not found"
      description="We couldn't find the page you were looking for."
      detail={
        <code className="max-w-full truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
          {location.pathname}
        </code>
      }
      actions={
        <>
          <BackButton />
          <HomeAction isAuthenticated={isAuthenticated} />
        </>
      }
    />
  )
}

export function ForbiddenScreen({ permission }: { permission?: Permission }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const role = useCurrentRole()
  const allowed = permission ? rolesWithPermission(permission) : []

  return (
    <StatusScreen
      icon={<ShieldAlertIcon />}
      code="403"
      title="You don't have access to this page"
      description={
        allowed.length > 0
          ? `This page is limited to ${allowed
              .map((r) => ROLE_LABEL[r].toLowerCase() + "s")
              .join(
                " and "
              )} of this organization. Ask an owner to change your role if you need it.`
          : "Your role in this organization doesn't include access to this page. Ask an owner if you need it."
      }
      detail={
        role ? (
          <div className="flex items-center gap-2">
            <span className="text-[0.625rem] tracking-wide text-muted-foreground uppercase">
              Your role
            </span>
            <Badge variant="outline">{ROLE_LABEL[role]}</Badge>
          </div>
        ) : null
      }
      actions={
        <>
          <BackButton />
          <HomeAction isAuthenticated={isAuthenticated} />
        </>
      }
    />
  )
}

// Route-level error boundary: an uncaught render/loader throw would otherwise
// blank the page with nothing but a console trace.
export function AppErrorScreen({
  error,
  reset,
}: {
  error: unknown
  reset?: () => void
}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const message = xgMessage(error)

  return (
    <StatusScreen
      icon={<TriangleAlertIcon />}
      code="Error"
      title="Something went wrong"
      description="This page failed to render. Retrying usually clears it — if it doesn't, the details below help us track it down."
      detail={
        message ? (
          <code className="max-w-full overflow-x-auto rounded-md bg-muted px-2 py-1 text-left font-mono text-xs break-words text-muted-foreground">
            {message}
          </code>
        ) : null
      }
      actions={
        <>
          {reset ? (
            <Button variant="outline" onClick={reset}>
              <RotateCcwIcon data-icon="inline-start" />
              Try again
            </Button>
          ) : null}
          <HomeAction isAuthenticated={isAuthenticated} />
        </>
      }
    />
  )
}
