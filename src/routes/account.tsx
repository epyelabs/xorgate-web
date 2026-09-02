import { useEffect, useRef, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { ImageUpIcon, Trash2Icon } from "lucide-react"
import { DestroyDialog } from "@/components/destroy-dialog"
import { EntityLogo } from "@/components/entity-logo"
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
import {
  changePassword,
  isFederatedUser,
  redirectToHostedLogout,
} from "@/lib/cognito"
import { ACCEPTED_TYPES, encodeAvatar } from "@/lib/image"
import {
  deleteMe,
  OwnsOrganizationsError,
  removeAvatar,
  updateMe,
  uploadAvatar,
  type AccountUser,
  type BlockingOrganization,
} from "@/lib/account-api"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"

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
          <TabsContent
            value="profile"
            className="flex max-w-2xl flex-col gap-8 text-sm"
          >
            <ProfileSection user={user} />
            <DangerZoneSection user={user} />
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

/**
 * Closing the account. Lives at the bottom of the profile tab rather than in a
 * tab of its own: it is the last thing on the page about "you", below
 * everything that can still be edited.
 *
 * /me does not say how many owners each organization has, so the screen
 * cannot know in advance which ones would block the deletion. It lists the
 * organizations the caller OWNS as a heads-up and lets the API decide; a 409
 * comes back with the exact blocking set, which is then shown with a link
 * into each organization's settings (hand it over on Members, or delete it).
 */
function DangerZoneSection({ user }: { user: AccountUser }) {
  const memberships = useAuthStore((s) => s.memberships)
  const organizations = useAuthStore((s) => s.organizations)
  const logout = useAuthStore((s) => s.logout)
  const setCurrentOrganization = useWorkspaceStore(
    (s) => s.setCurrentOrganization
  )
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [blocking, setBlocking] = useState<BlockingOrganization[] | null>(null)

  const owned = organizations.filter((org) =>
    memberships.some((m) => m.organizationId === org.id && m.role === "owner")
  )

  async function confirm() {
    try {
      await deleteMe()
    } catch (err) {
      if (err instanceof OwnsOrganizationsError) {
        setBlocking(err.organizations)
        setOpen(false)
        toast.error(err.message)
        return
      }
      toast.error(
        err instanceof Error ? err.message : "Could not delete your account"
      )
      return
    }
    toast.success("Your account has been deleted")
    // The credential is gone server-side; this clears what the browser still
    // holds — the same sequence as the sidebar's Log out.
    logout()
    if (redirectToHostedLogout()) return
    void navigate({ to: "/login", replace: true })
  }

  async function openOrganization(orgId: string) {
    await setCurrentOrganization(orgId)
    void navigate({ to: "/settings" })
  }

  const shown = blocking ?? owned

  return (
    <section className="flex flex-col gap-4 border-t border-border pt-6">
      <div>
        <h2 className="text-sm font-medium text-destructive">Delete account</h2>
        <p className="text-sm text-muted-foreground">
          Permanently removes your sign-in, profile, picture, live-video access
          and your membership in every organization. Organizations you belong to
          are not deleted.
        </p>
      </div>

      {shown.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">
            {blocking
              ? "You are the only owner of these organizations. Make another member an owner (Members) or delete them (Settings) first; an organization cannot be left without an owner."
              : `You own ${owned.length === 1 ? "an organization" : `${owned.length} organizations`}. If you are the only owner of any of them, you will be asked to hand it over or delete it first.`}
          </p>
          <ul className="flex flex-col gap-2">
            {shown.map((org) => (
              <li
                key={org.id}
                className="flex items-center justify-between gap-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <EntityLogo
                    name={org.name}
                    src={
                      organizations.find((o) => o.id === org.id)?.logoUrl ??
                      null
                    }
                    className="size-6 shrink-0"
                  />
                  <span className="truncate text-sm">{org.name}</span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void openOrganization(org.id)}
                >
                  Open settings
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={blocking !== null && blocking.length > 0}
          onClick={() => setOpen(true)}
        >
          <Trash2Icon />
          Delete my account
        </Button>
      </div>

      <DestroyDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete your account?"
        description={
          <>
            The account for{" "}
            <span className="font-medium text-foreground">{user.email}</span> is
            closed and you are signed out everywhere.
          </>
        }
        warning={
          <>
            <span className="font-medium text-foreground">
              This cannot be undone.
            </span>{" "}
            Your profile and picture are erased and you lose access to{" "}
            {memberships.length === 0
              ? "the console"
              : memberships.length === 1
                ? (organizations.find(
                    (o) => o.id === memberships[0]!.organizationId
                  )?.name ?? "your organization")
                : `${memberships.length} organizations`}
            . Signing up again with the same email starts from nothing.
          </>
        }
        confirmText={user.email}
        confirmLabel="Delete my account"
        pendingLabel="Deleting…"
        onConfirm={confirm}
      />
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
