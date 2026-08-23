import { useEffect, useState } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { addMemberSchema } from "@/lib/schemas"
import type { MembershipRole } from "@xorgate/sdk"
import { xg, xgMessage } from "@/lib/xorgate"

// Owner is intentionally omitted — transferring ownership is a separate flow;
// the add form only assigns the collaborator roles.
const ROLE_OPTIONS: { value: MembershipRole; label: string; hint: string }[] = [
  { value: "admin", label: "Admin", hint: "Manage members, devices, and settings" },
  { value: "member", label: "Member", hint: "Create and operate devices" },
  { value: "viewer", label: "Viewer", hint: "Read-only access" },
]

export function AddMemberDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: () => void
}) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<MembershipRole>("member")
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setEmail("")
    setRole("member")
    setSubmitting(false)
  }

  // Reset once the close animation settles so stale input never flashes back.
  useEffect(() => {
    if (!open) {
      const t = setTimeout(reset, 200)
      return () => clearTimeout(t)
    }
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = addMemberSchema.safeParse({ email, role })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input")
      return
    }
    setSubmitting(true)
    try {
      const { invited } = await xg().memberships.add(parsed.data)
      toast.success(
        invited
          ? `Invitation emailed to ${parsed.data.email}`
          : `Added ${parsed.data.email}`
      )
      onAdded()
      onOpenChange(false)
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={submitting ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Add a teammate by email. If they don’t have a xorgate account yet,
            we’ll create one and email them an invitation to set a password.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="member-email">Email</FieldLabel>
              <Input
                id="member-email"
                type="email"
                placeholder="teammate@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="member-role">Role</FieldLabel>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as MembershipRole)}
              >
                <SelectTrigger id="member-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="font-medium">{opt.label}</span>
                      <span className="text-muted-foreground">— {opt.hint}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Adding..." : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
