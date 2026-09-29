import { useState } from "react"
import { toast } from "sonner"
import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// The signing secret, shown once (create and rotate). Held only in the
// dialog's state, which is cleared after the dialog closes.
export function SecretReveal({
  secret,
  note,
}: {
  secret: string
  note?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Failed to copy to clipboard")
    }
  }

  return (
    <Field>
      <FieldLabel htmlFor="webhook-secret">Signing secret</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          id="webhook-secret"
          readOnly
          value={secret}
          className="font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
          data-testid="webhook-secret"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={copy}
          aria-label="Copy signing secret"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
      <FieldDescription className="flex items-start gap-1.5 text-amber-600 dark:text-amber-500">
        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Copy it now: it will not be shown again. Your receiver uses it to
          verify the <code>webhook-signature</code> header.
          {note ? ` ${note}` : null}
        </span>
      </FieldDescription>
    </Field>
  )
}
