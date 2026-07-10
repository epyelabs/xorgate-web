import { createFileRoute, redirect } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { StickyHeader } from "@/components/sticky-header"
import { useAuthStore } from "@/store/auth"

export const Route = createFileRoute("/billing")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: BillingPage,
})

function BillingPage() {
  const authUser = useAuthStore((s) => s.user)
  const tier = authUser?.tier ?? "free"

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground">
            Your current plan and usage tier.
          </p>
        </header>
      </StickyHeader>

      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
          <CardDescription>Your current plan and usage tier.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium capitalize">{tier} plan</span>
            <span className="text-xs text-muted-foreground">Billed monthly.</span>
          </div>
          <Button variant="outline" disabled>
            Manage billing
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
