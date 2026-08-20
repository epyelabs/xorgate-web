import { createFileRoute, redirect } from "@tanstack/react-router"
import { OnboardingForm } from "@/components/onboarding-form"
import { XorgateLogo } from "@/components/xorgate-logo"
import { useAuthStore } from "@/store/auth"
import { DEFAULT_AUTHED_ROUTE, requireAuthOnly } from "@/lib/auth-guard"

// Where a signed-in user with no organization is sent. Guarded by
// requireAuthOnly rather than requireAuth: requireAuth redirects org-less users
// HERE, so guarding this route with it would loop.
export const Route = createFileRoute("/onboarding")({
  beforeLoad: async (opts) => {
    await requireAuthOnly(opts)
    // Already onboarded, or arrived by typing the URL. Nothing to do here.
    if (useAuthStore.getState().organizations.length > 0) {
      throw redirect({ to: DEFAULT_AUTHED_ROUTE, replace: true })
    }
  },
  component: OnboardingPage,
})

function OnboardingPage() {
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <span className="flex items-center gap-2 self-center font-medium">
          <XorgateLogo className="size-8 text-primary" />
          xorgate
        </span>
        <OnboardingForm />
      </div>
    </div>
  )
}
