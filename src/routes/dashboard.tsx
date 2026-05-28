import { useEffect, useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getMe, type MeResponse } from "@/lib/api"
import { meResponseSchema } from "@/lib/schemas"
import { useAuthStore } from "@/store/auth"

export const Route = createFileRoute("/dashboard")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DashboardPage,
})

function DashboardPage() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const raw = await getMe()
        const parsed = meResponseSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error("Unexpected /me response shape")
        }
        if (!cancelled) setMe(parsed.data)
      } catch (err) {
        const message = (err as Error).message
        if (!cancelled) setError(message)
        toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <Card>
        <CardHeader>
          <CardTitle>GET /me</CardTitle>
          <CardDescription>
            Live response from the xorgate-core-service backend.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : me ? (
            <pre className="bg-muted overflow-auto rounded-md p-4 font-mono text-xs">
              {JSON.stringify(me, null, 2)}
            </pre>
          ) : (
            <p className="text-muted-foreground animate-pulse text-sm">
              Loading...
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
