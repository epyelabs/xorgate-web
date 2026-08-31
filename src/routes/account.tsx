import { useEffect, useRef, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { toast } from "sonner"
import { ImageUpIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StickyHeader } from "@/components/sticky-header"
import { UserAvatar } from "@/components/user-avatar"
import { requireAuth } from "@/lib/auth-guard"
import { changePassword, isFederatedUser } from "@/lib/cognito"
import { ACCEPTED_TYPES, encodeAvatar } from "@/lib/image"
import {
  removeAvatar,
  updateMe,
  uploadAvatar,
  type AccountUser,
} from "@/lib/account-api"
import { useAuthStore } from "@/store/auth"

export const Route = createFileRoute("/account")({
  beforeLoad: requireAuth,
  component: AccountPage,
})

/** Cognito's own minimum for this pool (auth-stack.ts: minLength 8). */
const MIN_PASSWORD_LENGTH = 8

/**
 * Cognito rejections carry a `code`; the raw messages are serviceable but the
 * three a user actually causes deserve field-level wording.
 */
function passwordErrorMessage(err: unknown): string {
  const code =
    (err as { code?: string; name?: string } | null)?.code ??
    (err as { name?: string } | null)?.name
  if (code === "NotAuthorizedException") {
    return "Your current password is incorrect"
  }
  if (code === "LimitExceededException") {
    return "Too many attempts. Wait a few minutes and try again."
  }
  if (code === "InvalidPasswordException") {
    return "That password does not meet the requirements"
  }
  return err instanceof Error ? err.message : "Could not change your password"
}

function AccountPage() {
  const user = useAuthStore((s) => s.user)

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
          <p className="text-sm text-muted-foreground">
            Your profile and sign-in details. These follow you across every
            organization you belong to.
          </p>
        </header>
      </StickyHeader>

      {/* The shell does not render a page until the session is restored, so
          `user` is present here; the guard is for the type, not a real state. */}
      {user ? (
        <Tabs defaultValue="profile" className="gap-6">
          <div className="border-b border-border">
            <TabsList variant="line">
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="password">Password</TabsTrigger>
            </TabsList>
          </div>
          {/* TabsContent defaults to text-xs; the forms below are text-sm. */}
          <TabsContent value="profile" className="max-w-2xl text-sm">
            <ProfileSection user={user} />
          </TabsContent>
          <TabsContent value="password" className="max-w-2xl text-sm">
            <PasswordSection />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  )
}

/**
 * Each write answers with the updated user and is written straight into the
 * auth store, so the new name or picture is on screen — here and in the
 * sidebar — in the same frame, with no second round trip and nothing here
 * holding a copy of the profile.
 */
function ProfileSection({ user }: { user: AccountUser }) {
  const applyUser = useAuthStore((s) => s.applyUser)
  const fileInput = useRef<HTMLInputElement>(null)
  const [savingName, setSavingName] = useState(false)
  const [uploading, setUploading] = useState(false)
  // Derived, not effect-synced (same shape as the organization settings page):
  // the input shows the pending edit if there is one, else the stored name.
  const [editedName, setEditedName] = useState<string | null>(null)
  const name = editedName ?? user.name ?? ""
  /** Object URL of the picture being uploaded, shown until the server's replaces it. */
  const [preview, setPreview] = useState<string | null>(null)

  // Object URLs are a document-lifetime allocation; release each one as soon as
  // it stops being the picture on screen.
  useEffect(() => {
    if (!preview) return
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  const dirty = editedName !== null && editedName.trim() !== (user.name ?? "")

  async function saveName(event: React.FormEvent) {
    event.preventDefault()
    const next = name.trim()
    if (!next) return
    setSavingName(true)
    try {
      const result = await updateMe({ name: next })
      applyUser(result.user)
      setEditedName(null)
      toast.success("Profile updated")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save your profile"
      )
    } finally {
      setSavingName(false)
    }
  }

  async function pickPicture(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Clear immediately so re-picking the SAME file still fires a change event.
    event.target.value = ""
    if (!file) return

    setUploading(true)
    try {
      const encoded = await encodeAvatar(file)
      setPreview(encoded.previewUrl)
      const result = await uploadAvatar({
        contentType: encoded.contentType,
        data: encoded.data,
      })
      applyUser(result.user)
      toast.success("Profile picture updated")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not upload that picture"
      )
    } finally {
      // The stored URL is authoritative from here, whether the upload landed
      // or not — leaving a stale preview up would misreport a failure.
      setPreview(null)
      setUploading(false)
    }
  }

  async function removePicture() {
    setUploading(true)
    try {
      const result = await removeAvatar()
      applyUser(result.user)
      toast.success("Profile picture removed")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not remove the picture"
      )
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        How you appear to the rest of your organization.
      </p>

      <div className="flex items-center gap-4">
        <UserAvatar
          name={user.name}
          email={user.email}
          src={preview ?? user.avatarUrl}
          className="size-16"
        />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              className="sr-only"
              onChange={pickPicture}
              data-testid="avatar-input"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              <ImageUpIcon />
              {uploading ? "Uploading…" : "Change picture"}
            </Button>
            {user.avatarUrl ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={uploading}
                onClick={removePicture}
              >
                <Trash2Icon />
                Remove
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            JPEG, PNG, WebP or GIF. Cropped to a square and resized for you.
          </p>
        </div>
      </div>

      <form onSubmit={saveName} className="flex flex-col gap-6">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="account-name">Name</FieldLabel>
            <Input
              id="account-name"
              value={name}
              autoComplete="name"
              placeholder="Your name"
              onChange={(event) => setEditedName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="account-email">Email</FieldLabel>
            <Input id="account-email" value={user.email} disabled readOnly />
            <FieldDescription>
              Your email is your sign-in and cannot be changed here.
            </FieldDescription>
          </Field>
        </FieldGroup>
        <div>
          <Button
            type="submit"
            size="sm"
            disabled={savingName || !dirty || !name.trim()}
          >
            {savingName ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </section>
  )
}

function PasswordSection() {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [saving, setSaving] = useState(false)
  // Null until the session has been read. A Google user has no Cognito
  // password, so the form is replaced rather than shown and then refused.
  const [federated, setFederated] = useState<boolean | null>(null)

  useEffect(() => {
    let live = true
    isFederatedUser()
      .then((value) => {
        if (live) setFederated(value)
      })
      .catch(() => {
        // Unreadable session: fall back to showing the form. Cognito refuses a
        // federated change anyway, and the error message says so.
        if (live) setFederated(false)
      })
    return () => {
      live = false
    }
  }, [])

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH
  const mismatch = confirm.length > 0 && confirm !== next
  const submittable =
    current.length > 0 && next.length >= MIN_PASSWORD_LENGTH && confirm === next

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!submittable) return
    setSaving(true)
    try {
      await changePassword(current, next)
      setCurrent("")
      setNext("")
      setConfirm("")
      // The session survives a password change, so there is nothing to sign
      // out of — Cognito keeps the existing tokens valid.
      toast.success("Password changed")
    } catch (err) {
      toast.error(passwordErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (federated === null) return null

  if (federated) {
    return (
      <section className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          You sign in with Google, so there is no xorgate password to change.
          Manage it in your Google account.
        </p>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        At least {MIN_PASSWORD_LENGTH} characters. You stay signed in on this
        device.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-6">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="current-password">Current password</FieldLabel>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              aria-invalid={tooShort || undefined}
              onChange={(event) => setNext(event.target.value)}
            />
            {tooShort ? (
              <FieldDescription className="text-destructive">
                Use at least {MIN_PASSWORD_LENGTH} characters.
              </FieldDescription>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm-password">
              Confirm new password
            </FieldLabel>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              aria-invalid={mismatch || undefined}
              onChange={(event) => setConfirm(event.target.value)}
            />
            {mismatch ? (
              <FieldDescription className="text-destructive">
                The two passwords do not match.
              </FieldDescription>
            ) : null}
          </Field>
        </FieldGroup>
        <div>
          <Button type="submit" size="sm" disabled={saving || !submittable}>
            {saving ? "Changing…" : "Change password"}
          </Button>
        </div>
      </form>
    </section>
  )
}
