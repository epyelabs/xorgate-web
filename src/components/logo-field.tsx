import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ImageUpIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EntityLogo } from "@/components/entity-logo"
import { ACCEPTED_TYPES, encodeLogo } from "@/lib/image"

/**
 * The picture half of an organization's or a workspace's identity: the mark
 * itself, a button to replace it and one to clear it.
 *
 * It is never part of a surrounding form's submit — an upload lands on its
 * own, the way a profile picture does — so there is no half-saved state where
 * the logo changed but the name did not. That is also why it takes callbacks
 * rather than an id: the caller owns which endpoint to write and which store
 * to fold the answer back into, and this owns the encode/preview/busy dance
 * that is identical for both.
 */
export function LogoField({
  name,
  logoUrl,
  disabled = false,
  onUpload,
  onRemove,
  inputTestId,
}: {
  /** Drives the initials fallback when there is no logo. */
  name: string
  logoUrl: string | null
  /** True for a role that may read the settings but not change them. */
  disabled?: boolean
  onUpload: (input: { contentType: string; data: string }) => Promise<void>
  onRemove: () => Promise<void>
  inputTestId?: string
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  /** Object URL of the logo being uploaded, shown until the server's replaces it. */
  const [preview, setPreview] = useState<string | null>(null)

  // Object URLs are a document-lifetime allocation; release each one as soon as
  // it stops being the picture on screen.
  useEffect(() => {
    if (!preview) return
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  async function pickLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Clear immediately so re-picking the SAME file still fires a change event.
    event.target.value = ""
    if (!file) return

    setBusy(true)
    try {
      const encoded = await encodeLogo(file)
      setPreview(encoded.previewUrl)
      await onUpload({ contentType: encoded.contentType, data: encoded.data })
      toast.success("Logo updated")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not upload that logo"
      )
    } finally {
      // The stored URL is authoritative from here, whether the upload landed
      // or not — leaving a stale preview up would misreport a failure.
      setPreview(null)
      setBusy(false)
    }
  }

  async function removeLogo() {
    setBusy(true)
    try {
      await onRemove()
      toast.success("Logo removed")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the logo")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <EntityLogo
        name={name}
        src={preview ?? logoUrl}
        className="size-16"
        fallbackClassName="text-lg"
      />
      {disabled ? null : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              className="sr-only"
              onChange={pickLogo}
              data-testid={inputTestId}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <ImageUpIcon />
              {busy ? "Uploading…" : "Change logo"}
            </Button>
            {logoUrl ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={removeLogo}
              >
                <Trash2Icon />
                Remove
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            JPEG, PNG, WebP or GIF. Fitted into a square for you; a transparent
            background stays transparent.
          </p>
        </div>
      )}
    </div>
  )
}
