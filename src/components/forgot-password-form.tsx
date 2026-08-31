import { useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import * as cognito from "@/lib/cognito"
import { useAuthStore } from "@/store/auth"
import { DEFAULT_AUTHED_ROUTE } from "@/lib/auth-guard"

/**
 * Self-serve password reset against xorgate's Cognito pool, in two steps on one
 * screen: ask for the address, then take the emailed code together with the new
 * password. A successful reset signs the user straight in — the credentials are
 * already in memory, so there is no reason to make them type the new password a
 * second time on /login.
 *
 * Passwords never touch the platform API here either; the browser talks to
 * Cognito directly, exactly as sign-in does.
 */
export function ForgotPasswordForm({
  initialEmail = "",
  className,
  ...props
}: React.ComponentProps<"div"> & { initialEmail?: string }) {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [codeSent, setCodeSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function requestCode() {
    await cognito.forgotPassword(email.trim())
    setCodeSent(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      if (!codeSent) {
        await requestCode()
        toast.success(`A reset code is on its way to ${email.trim()}`)
        return
      }
      if (newPassword.length < 8) {
        toast.error("Password must be at least 8 characters")
        return
      }
      await cognito.confirmForgotPassword(
        email.trim(),
        code.trim(),
        newPassword
      )
      toast.success("Password updated")
      try {
        await login(email.trim(), newPassword)
        navigate({ href: DEFAULT_AUTHED_ROUTE, replace: true })
      } catch {
        // The reset itself succeeded, so send them to sign in rather than
        // reporting a failure they would try to undo.
        navigate({ to: "/login", replace: true })
      }
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResend() {
    setSubmitting(true)
    try {
      await requestCode()
      toast.success(`A new code is on its way to ${email.trim()}`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            {codeSent ? "Choose a new password" : "Reset your password"}
          </CardTitle>
          <CardDescription>
            {codeSent ? (
              <>
                Enter the code we emailed to <strong>{email.trim()}</strong>{" "}
                along with your new password.
              </>
            ) : (
              "Enter the email address for your account and we'll send you a reset code."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              {codeSent ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="reset-code">Reset code</FieldLabel>
                    <Input
                      id="reset-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      className="text-center tracking-[0.3em]"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      autoFocus
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="new-password">New password</FieldLabel>
                    <Input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />
                    <FieldDescription>
                      Must be at least 8 characters.
                    </FieldDescription>
                  </Field>
                </>
              ) : (
                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    placeholder="m@example.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                    required
                  />
                </Field>
              )}
              <Field>
                <Button
                  type="submit"
                  variant="brand"
                  disabled={submitting || (codeSent && !code.trim())}
                >
                  {submitting
                    ? codeSent
                      ? "Updating..."
                      : "Sending..."
                    : codeSent
                      ? "Set new password"
                      : "Send reset code"}
                </Button>
              </Field>
              {codeSent && (
                <FieldDescription className="text-center">
                  Didn&apos;t get it, or has the code expired?{" "}
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleResend}
                    className="underline-offset-4 hover:underline disabled:opacity-50"
                  >
                    Re-send code
                  </button>
                </FieldDescription>
              )}
              <FieldDescription className="text-center">
                Remembered it?{" "}
                <Link
                  to="/login"
                  className="underline-offset-4 hover:underline"
                >
                  Back to sign in
                </Link>
              </FieldDescription>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
