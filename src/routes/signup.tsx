import { createFileRoute, redirect } from "@tanstack/react-router"
import { SignupForm } from "@/components/signup-form"
import { XorgateLogo } from "@/components/xorgate-logo"
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
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a href="/" className="flex items-center gap-2 self-center font-medium">
          <XorgateLogo className="size-8 text-primary" />
          xorgate
        </a>
        <SignupForm />
      </div>
    </div>
  )
}
