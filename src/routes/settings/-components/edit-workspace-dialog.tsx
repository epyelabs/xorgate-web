import { useState } from "react"
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { LogoField } from "@/components/logo-field"
import { createWorkspaceSchema } from "@/lib/schemas"
import {
  removeWorkspaceLogo,
  uploadWorkspaceLogo,
  type BrandedWorkspace,
} from "@/lib/branding-api"
import { xgMessage } from "@/lib/xorgate"
import { useWorkspaceStore } from "@/store/workspace"

// Edit dialog for an existing workspace. Mirrors CreateWorkspaceDialog but
// pre-fills from the selected row and calls updateWorkspace. The inner form is
// keyed by workspace id so its fields initialise straight from props on mount,
// avoiding a seed-from-effect.
export function EditWorkspaceDialog({
  open,
  onOpenChange,
  workspace,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: BrandedWorkspace | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit workspace</DialogTitle>
          <DialogDescription>
            Update this workspace's logo, name, slug, or description.
          </DialogDescription>
        </DialogHeader>
        {workspace ? (
          <EditWorkspaceForm
            key={workspace.id}
            workspace={workspace}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function EditWorkspaceForm({
  workspace,
  onClose,
}: {
  workspace: BrandedWorkspace
  onClose: () => void
}) {
  const applyWorkspace = useWorkspaceStore((s) => s.applyWorkspace)
  // The `workspace` prop is the row as it was when the menu was opened. The
  // logo is written while the dialog is still up, so it reads the LIVE row
  // instead — otherwise the Remove button would not appear until a reopen.
  // The text fields deliberately do not: they are drafts seeded at mount.
  const live = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === workspace.id)
  )
  const logoUrl = (live ?? workspace).logoUrl
  const [name, setName] = useState(workspace.name)
  const [slug, setSlug] = useState(workspace.slug)
  const [description, setDescription] = useState(workspace.description ?? "")
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = createWorkspaceSchema.safeParse({
      name,
      slug,
      description: description.trim() || undefined,
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input")
      return
    }
    setSubmitting(true)
    try {
      const updated = await useWorkspaceStore.getState().updateWorkspace(
        workspace.id,
        {
          name: parsed.data.name,
          slug: parsed.data.slug,
          description: parsed.data.description ?? null,
        }
      )
      toast.success(`Workspace "${updated.name}" updated`)
      onClose()
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Outside the FieldGroup and outside the submit: the logo lands on its
          own upload, so closing without saving still keeps it. The name shown
          beside it is the DRAFT, so the initials fallback tracks what is being
          typed rather than the stored name. */}
      <div className="mb-6 flex flex-col gap-2">
        <FieldLabel>Logo</FieldLabel>
        <LogoField
          name={name || workspace.name}
          logoUrl={logoUrl}
          inputTestId="workspace-logo-input"
          onUpload={async (input) => {
            const result = await uploadWorkspaceLogo(workspace.id, input)
            applyWorkspace(result.workspace)
          }}
          onRemove={async () => {
            const result = await removeWorkspaceLogo(workspace.id)
            applyWorkspace(result.workspace)
          }}
        />
      </div>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="edit-workspace-name">Name</FieldLabel>
          <Input
            id="edit-workspace-name"
            placeholder="Frontier"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="edit-workspace-slug">Slug</FieldLabel>
          <Input
            id="edit-workspace-slug"
            placeholder="frontier"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="edit-workspace-description">
            Description (optional)
          </FieldLabel>
          <Input
            id="edit-workspace-description"
            placeholder="What this workspace is for"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </FieldGroup>
      <DialogFooter className="mt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  )
}
