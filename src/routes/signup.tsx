import { createFileRoute, redirect } from "@tanstack/react-router"
import { SignupForm } from "@/components/signup-form"
import { XorgateLogo } from "@/components/xorgate-logo"
import { AccentField } from "@/components/accent-field"
import { useAuthStore } from "@/store/auth"
import { DEFAULT_AUTHED_ROUTE, ensureAuthInitialized } from "@/lib/auth-guard"

export const Route = createFileRoute("/signup")({
  beforeLoad: async () => {
    await ensureAuthInitialized()
    if (useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: DEFAULT_AUTHED_ROUTE })
    }
  },
  component: SignupPage,
})

function SignupPage() {
  return (
    <div className="relative isolate flex min-h-svh flex-col items-center justify-center gap-6 bg-shell p-6 md:p-10">
      <AccentField variant="grid-full" />
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a href="/" className="self-center" aria-label="xorgate">
          <XorgateLogo className="h-7 w-auto text-brand" />
        </a>
        <SignupForm />
      </div>
    </div>
  )
}
