import { useEffect } from "react"
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { useAuthStore } from "@/store/auth"

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && isAuthenticated) {
      throw redirect({ to: "/devices" })
    }
  },
  component: LandingPage,
})

function LandingPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const navigate = useNavigate()

  useEffect(() => {
    if (isAuthenticated) {
      navigate({ to: "/devices", replace: true })
    }
  }, [isAuthenticated, navigate])

  return (
    <div className="flex min-h-svh items-center justify-center px-6">
      <div className="flex max-w-xl flex-col items-center gap-6 text-center">
        <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
          Build with xorgate
        </h1>
        <p className="text-base text-muted-foreground sm:text-lg">
          Landing page will be displayed here
        </p>
        <div className="flex gap-3">
          <Button asChild>
            <Link to="/signup">Get started</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/login">Log in</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
