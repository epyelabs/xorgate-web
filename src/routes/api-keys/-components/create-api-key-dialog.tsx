import { useEffect, useState } from "react"
import { toast } from "sonner"
import { CheckIcon, CopyIcon } from "lucide-react"
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
import { createApiKeySchema } from "@/lib/schemas"
import { ApiError, createApiKey, type ApiKeyScope } from "@/lib/api"

const SCOPE_OPTIONS: { value: ApiKeyScope; label: string; hint: string }[] = [
  { value: "client", label: "Client", hint: "Frontend / dashboard clients" },
  { value: "cloud", label: "Cloud", hint: "Server-to-server integrations" },
  { value: "edge", label: "Edge", hint: "On-device edge agents" },
]

export function CreateApiKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [name, setName] = useState("")
  const [scope, setScope] = useState<ApiKeyScope>("client")
  const [submitting, setSubmitting] = useState(false)
  const [plaintext, setPlaintext] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function reset() {
    setName("")
    setScope("client")
    setSubmitting(false)
    setPlaintext(null)
    setCopied(false)
  }

  // Reset once the close animation settles so the secret never flashes back on
  // the next open.
  useEffect(() => {
    if (!open) {
      const t = setTimeout(reset, 200)
      return () => clearTimeout(t)
    }
  }, [open])

  function handleOpenChange(next: boolean) {
    // Block dismissal mid-request so the secret isn't lost before it renders.
    if (submitting) return
    onOpenChange(next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = createApiKeySchema.safeParse({ name, scope })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input")
      return
    }
    setSubmitting(true)
    try {
      const { plaintext_key } = await createApiKey(parsed.data)
      setPlaintext(plaintext_key)
      onCreated()
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : (err as Error).message ?? "Failed to create API key"
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopy() {
    if (!plaintext) return
    try {
      await navigator.clipboard.writeText(plaintext)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Failed to copy to clipboard")
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
          <DialogDescription>
            {plaintext
              ? "Copy your key now. For security, it won't be shown again."
              : "API keys authenticate programmatic access to this organization."}
          </DialogDescription>
        </DialogHeader>

        {plaintext ? (
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="api-key-secret">Secret key</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="api-key-secret"
                  readOnly
                  value={plaintext}
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                  aria-label="Copy secret key"
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </Button>
              </div>
            </Field>
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
                <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
                <Input
                  id="api-key-name"
                  placeholder="Production server"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="api-key-scope">Scope</FieldLabel>
                <Select
                  value={scope}
                  onValueChange={(v) => setScope(v as ApiKeyScope)}
                >
                  <SelectTrigger id="api-key-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <span className="font-medium">{opt.label}</span>
                        <span className="text-muted-foreground">
                          — {opt.hint}
                        </span>
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
                {submitting ? "Creating..." : "Create key"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
