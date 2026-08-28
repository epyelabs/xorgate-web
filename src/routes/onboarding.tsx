import { createFileRoute, redirect } from "@tanstack/react-router"
import { OnboardingForm } from "@/components/onboarding-form"
import { XorgateLogo } from "@/components/xorgate-logo"
import { AccentField } from "@/components/accent-field"
import { useAuthStore } from "@/store/auth"
import {
  DEFAULT_AUTHED_ROUTE,
  requireAuthOnly,
  requireProfile,
} from "@/lib/auth-guard"

// Where a signed-in user with no organization is sent. Guarded by
// requireAuthOnly rather than requireAuth: requireAuth redirects org-less users
// HERE, so guarding this route with it would loop.
export const Route = createFileRoute("/onboarding")({
  beforeLoad: async (opts) => {
    await requireAuthOnly(opts)
    // requireAuthOnly deliberately skips the org check, so this route has to
    // ask for the profile itself. Without it the bounce below reads the same
    // unhydrated `organizations: []` that sent the user here and strands them
    // on the form — the second half of the intermittent-onboarding bug.
    await requireProfile(opts)
    // Already onboarded, or arrived by typing the URL. Nothing to do here.
    if (useAuthStore.getState().organizations.length > 0) {
      throw redirect({ to: DEFAULT_AUTHED_ROUTE, replace: true })
    }
  },
  component: OnboardingPage,
})

function OnboardingPage() {
  return (
    <div className="relative isolate flex min-h-svh flex-col items-center justify-center gap-6 bg-shell p-6 md:p-10">
      <AccentField variant="grid-full" />
      <div className="flex w-full max-w-sm flex-col gap-6">
        <XorgateLogo className="h-7 w-auto self-center text-brand" />
        <OnboardingForm />
      </div>
    </div>
  )
}
