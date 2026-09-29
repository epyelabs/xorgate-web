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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { xgMessage } from "@/lib/xorgate"
import { createWebhook, type WebhookEndpoint } from "@/lib/webhooks-api"
import { useInvalidateWebhooks } from "@/queries/webhooks"
import { SecretReveal } from "./secret-reveal"

// The backend's name rule: the handle a template's output.event node carries.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function validate(name: string, url: string): string | null {
  if (!NAME_RE.test(name))
    return "Name: letters, digits, '.', '_' or '-', starting with a letter or digit (at most 64)."
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return "URL: not a valid URL."
  }
  if (parsed.protocol !== "https:") return "URL: must start with https://."
  return null
}

/**
 * Register an endpoint (name, URL, description), then show its signing secret
 * once. Opened from the Webhook endpoints page and, inline, from the two
 * routing surfaces ("+ New endpoint" in the node panel and the device
 * Settings -> Webhooks sub-tab); `onCreated` hands the new endpoint back so the
 * opener can select it. `initialName` pre-fills the name (the node picker
 * passes an unbound name so creating it binds the node).
 */
export function CreateWebhookDialog({
  open,
  onOpenChange,
  onCreated,
  initialName = "",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (endpoint: WebhookEndpoint) => void
  initialName?: string
}) {
  const [name, setName] = useState(initialName)
  const [url, setUrl] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const invalidate = useInvalidateWebhooks()

  // Seed the name as the dialog opens (adjusted during render, not in an
  // effect), and reset after the close animation so the secret never flashes
  // back on the next open.
  const [seenOpen, setSeenOpen] = useState(open)
  if (open !== seenOpen) {
    setSeenOpen(open)
    if (open) setName(initialName)
  }
  useEffect(() => {
    if (open) return
    const t = setTimeout(() => {
      setName("")
      setUrl("")
      setDescription("")
      setSubmitting(false)
      setSecret(null)
    }, 200)
    return () => clearTimeout(t)
  }, [open])

  function handleOpenChange(next: boolean) {
    // Block dismissal mid-request so the secret isn't lost before it renders.
    if (submitting) return
    onOpenChange(next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const n = name.trim()
    const u = url.trim()
    const problem = validate(n, u)
    if (problem) {
      toast.error(problem)
      return
    }
    setSubmitting(true)
    try {
      const res = await createWebhook({
        name: n,
        url: u,
        description: description.trim() || null,
      })
      setSecret(res.secret)
      invalidate()
      onCreated?.(res.webhook)
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="create-webhook-dialog">
        <DialogHeader>
          <DialogTitle>New webhook endpoint</DialogTitle>
          <DialogDescription>
            {secret
              ? `"${name.trim()}" is registered. It receives nothing until a device route or a workflow node points at it.`
              : "An HTTPS receiver for signed event deliveries. Workflow nodes and device routes refer to it by name."}
          </DialogDescription>
        </DialogHeader>

        {secret ? (
          <div className="flex flex-col gap-4">
            <SecretReveal secret={secret} />
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="webhook-name">Name</FieldLabel>
                <Input
                  id="webhook-name"
                  placeholder="dispatch"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  required
                  className="font-mono"
                />
                <FieldDescription>
                  The handle a workflow's output.event node uses. Unique in
                  this organization.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="webhook-url">URL</FieldLabel>
                <Input
                  id="webhook-url"
                  type="url"
                  placeholder="https://example.com/hooks/xorgate"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
                <FieldDescription>
                  HTTPS only; private and loopback addresses are refused and
                  redirects are not followed.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="webhook-description">
                  Description <span className="text-muted-foreground">(optional)</span>
                </FieldLabel>
                <Textarea
                  id="webhook-description"
                  rows={2}
                  maxLength={500}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
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
                {submitting ? "Creating..." : "Create endpoint"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
