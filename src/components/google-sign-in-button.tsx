import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Field, FieldSeparator } from "@/components/ui/field"
import { GoogleIcon } from "@/components/google-icon"
import { oauthEnabled, signInWithProvider } from "@/lib/cognito"

// "Or continue with" separator + the Google button, shared by the login and
// signup forms. Renders nothing when Hosted-UI federation is not configured
// (VITE_COGNITO_DOMAIN unset), so a build without Google wired stays as it was.
export function GoogleSignInButton({
  disabled,
  returnTo,
}: {
  disabled?: boolean
  // Same-origin path to land on after the round trip (the login page's
  // `?redirect=`), already sanitized by the caller.
  returnTo?: string
}) {
  const [redirecting, setRedirecting] = useState(false)
  if (!oauthEnabled) return null

  async function handleClick() {
    setRedirecting(true)
    try {
      await signInWithProvider("Google", returnTo)
      // The browser is navigating away; leave the button disabled.
    } catch (err) {
      setRedirecting(false)
      toast.error((err as Error).message)
    }
  }

  return (
    <>
      <FieldSeparator>Or continue with</FieldSeparator>
      <Field>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || redirecting}
          onClick={() => void handleClick()}
        >
          <GoogleIcon />
          {redirecting ? "Redirecting to Google..." : "Continue with Google"}
        </Button>
      </Field>
    </>
  )
}
