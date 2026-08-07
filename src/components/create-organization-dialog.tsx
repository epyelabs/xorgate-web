import { useState } from "react"
import { useLocation, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { createOrganizationSchema } from "@/lib/schemas"
import { slugify } from "@/lib/utils"
import { ApiError } from "@/lib/api"
import { useWorkspaceStore } from "@/store/workspace"
import { DEFAULT_AUTHED_ROUTE } from "@/lib/auth-guard"
import { shouldLeaveOnContextSwitch } from "@/lib/context-scope"

export function CreateOrganizationDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const pathname = useLocation({ select: (l) => l.pathname })
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setName("")
    setSlug("")
    setSlugTouched(false)
    setSubmitting(false)
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  function handleNameChange(value: string) {
    setName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = createOrganizationSchema.safeParse({ name, slug })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input")
      return
    }
    setSubmitting(true)
    try {
      const org = await useWorkspaceStore
        .getState()
        .createOrganization(parsed.data)
      toast.success(`Organization "${org.name}" created`)
      reset()
      onOpenChange(false)
      // Creating switches the active organization, so the page behind the
      // dialog is stranded on the one just left if it was a detail page.
      if (shouldLeaveOnContextSwitch(pathname, "organization")) {
        void navigate({ to: DEFAULT_AUTHED_ROUTE })
      }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : (err as Error).message ?? "Failed to create organization"
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            Organizations hold their own workspaces, members, and settings.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="org-name">Name</FieldLabel>
              <Input
                id="org-name"
                placeholder="Acme Inc"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                autoFocus
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="org-slug">Slug</FieldLabel>
              <Input
                id="org-slug"
                placeholder="acme-inc"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true)
                  setSlug(e.target.value)
                }}
                required
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
