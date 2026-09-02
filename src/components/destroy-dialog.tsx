import { useState } from "react"
import { TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * The confirmation for the two deletions that take other people's access with
 * them — an organization, the account — and for handing an organization over.
 * Same skeleton as the per-entity delete dialogs (a destructive confirm, no
 * dismissal while the request is in flight) plus a callout that says what is
 * gone for good and, when `confirmText` is set, a phrase the person has to type
 * back before the button arms. The per-entity dialogs (device, workspace, API
 * key, member) keep their lighter shape on purpose: those are one row each and
 * re-creatable.
 */
export function DestroyDialog({
  open,
  onOpenChange,
  title,
  description,
  warning,
  confirmText,
  confirmLabel,
  pendingLabel,
  onConfirm,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  /** The sentence in the callout: what cannot be undone. */
  warning: React.ReactNode
  /** When set, the confirm button stays disabled until this is typed exactly. */
  confirmText?: string
  confirmLabel: string
  pendingLabel: string
  onConfirm: () => Promise<void> | void
  children?: React.ReactNode
}) {
  const [pending, setPending] = useState(false)
  const [typed, setTyped] = useState("")
  const armed = confirmText === undefined || typed.trim() === confirmText

  function handleOpenChange(next: boolean) {
    if (pending) return
    if (!next) setTyped("")
    onOpenChange(next)
  }

  async function handleConfirm() {
    if (!armed) return
    setPending(true)
    try {
      await onConfirm()
      setTyped("")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void handleConfirm()
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-xs text-muted-foreground">{warning}</p>
          </div>
          {children}
          {confirmText !== undefined ? (
            <div className="flex flex-col gap-2">
              <Label
                htmlFor="destroy-confirm"
                className="text-xs font-normal text-muted-foreground"
              >
                Type{" "}
                <span className="font-medium text-foreground">
                  {confirmText}
                </span>{" "}
                to confirm
              </Label>
              <Input
                id="destroy-confirm"
                value={typed}
                autoComplete="off"
                spellCheck={false}
                disabled={pending}
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending || !armed}
            >
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
