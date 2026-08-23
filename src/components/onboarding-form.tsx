import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
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
import { xgMessage } from "@/lib/xorgate"
import { createOrganizationSchema, createWorkspaceSchema } from "@/lib/schemas"
import { slugify } from "@/lib/utils"
import { DEFAULT_AUTHED_ROUTE } from "@/lib/auth-guard"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"

// The first workspace has to exist for the app to be usable, but naming it is
// not a decision a new user has any basis to make, so it is created silently
// and renamed later from Settings.
const FIRST_WORKSPACE_NAME = "Default"
const FIRST_WORKSPACE_SLUG = "default"

export function OnboardingForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const navigate = useNavigate()
  const email = useAuthStore((s) => s.user?.email ?? null)

  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function handleNameChange(value: string) {
    setName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsedOrg = createOrganizationSchema.safeParse({ name, slug })
    if (!parsedOrg.success) {
      toast.error(parsedOrg.error.issues[0]?.message ?? "Invalid input")
      return
    }
    setSubmitting(true)
    try {
      // Order matters and is not interchangeable: createOrganization() sets the
      // new org as active, and createWorkspace() needs that to send the
      // X-Organization-Id header. Creating the workspace first would 403.
      const org = await useWorkspaceStore
        .getState()
        .createOrganization(parsedOrg.data)

      // POST /organizations does NOT create a default workspace, so a user who
      // stopped here would still have a half-usable app.
      const parsedWorkspace = createWorkspaceSchema.parse({
        name: FIRST_WORKSPACE_NAME,
        slug: FIRST_WORKSPACE_SLUG,
      })
      await useWorkspaceStore.getState().createWorkspace(parsedWorkspace)

      toast.success(`Organization "${org.name}" created`)
      void navigate({ to: DEFAULT_AUTHED_ROUTE, replace: true })
    } catch (err) {
      const message =
        xgMessage(err) || "Failed to create organization"
      toast.error(message)
      setSubmitting(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>Create your organization</CardTitle>
          <CardDescription>
            {email
              ? `Signed in as ${email}. Every device, workflow and member lives inside an organization, so you need one before you can go further.`
              : "Every device, workflow and member lives inside an organization, so you need one before you can go further."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="org-name">Organization name</FieldLabel>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Acme Robotics"
                  autoFocus
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="org-slug">Slug</FieldLabel>
                <Input
                  id="org-slug"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true)
                    setSlug(e.target.value)
                  }}
                  placeholder="acme-robotics"
                  required
                />
                <FieldDescription>
                  Lowercase letters, numbers and dashes. Used in URLs.
                </FieldDescription>
              </Field>
              <Field>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating..." : "Create organization"}
                </Button>
                <FieldDescription>
                  A workspace named &quot;{FIRST_WORKSPACE_NAME}&quot; is
                  created alongside it. You can rename it later in Settings.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
