import { createFileRoute, redirect } from "@tanstack/react-router"
import { LoginForm } from "@/components/login-form"
import { XorgateLogo } from "@/components/xorgate-logo"
import { useAuthStore } from "@/store/auth"

export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && isAuthenticated) {
      throw redirect({ to: "/dashboard" })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a href="/" className="flex items-center gap-2 self-center font-medium">
          <XorgateLogo className="size-8 text-primary" />
          xorgate
        </a>
        <LoginForm />
      </div>
    </div>
  )
}
