import { useRef, useState } from "react"
import { AlertTriangleIcon, CircleDashedIcon, PencilIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import type { Device } from "@/lib/api"
import type { DeviceConfigStatus } from "@/lib/device-config-status"
import type { DeviceSettingsPatch } from "@/hooks/use-device-settings"
import {
  apnInputError,
  apnMachineNote,
  apnSaveGate,
  reportedApn,
  reportedUplink,
} from "@/lib/device-apn"
import { cn } from "@/lib/utils"
import { ConfigStatusBadge, ConfigStatusCallout } from "./config-status"
import { SettingsCallout } from "./callout"

const APN_KEY = "device-cellular-apn"

/**
 * The writable APN (manage_sim_card_info_in_settings, Phase 2). Every decision
 * — how much friction the save gets, what the machinery notes say, what counts
 * as a valid input — lives in `lib/device-apn.ts`, where the tests are; this
 * component renders and gates.
 *
 * The field is read-only until Edit is clicked. It is a value an operator comes
 * here to *read* far more often than to change, and one wrong keystroke away
 * from stranding the device, so typing in it has to be a decision rather than
 * something a stray click can start.
 *
 * The one rule that shapes the whole card: a wrong APN can strand an LTE-only
 * device permanently, so a save is never a quiet control. It is an explicit
 * button behind a confirmation whose weight scales with the risk — plain when
 * the device has a second link, typed-device-name when cellular is its only
 * way in, and a hard refusal when the device reports no rollback machinery at
 * all (writing there would have no safety net).
 */
export function ApnCard({
  device,
  configStatus,
  isPending,
  commit,
}: {
  device: Device
  configStatus: DeviceConfigStatus
  isPending: (key: string) => boolean
  commit: (key: string, patch: DeviceSettingsPatch) => void
}) {
  const apn = reportedApn(device)
  const uplink = reportedUplink(device)
  const gate = apnSaveGate(apn, uplink)
  const note = apnMachineNote(apn)

  const desired = device.config.cellular?.apn ?? ""
  const [draft, setDraft] = useState(desired)
  const [editing, setEditing] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [typedName, setTypedName] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const deviceName = device.name ?? device.serial
  const inputError = apnInputError(draft)
  const dirty = draft !== desired
  const clearing = draft === ""
  const blocked = gate.kind === "blocked"
  const pending = isPending(APN_KEY)

  function startEditing() {
    setEditing(true)
    // Focus survives the readOnly flip — the element is the same node either
    // way, so the operator can type straight after clicking Edit.
    inputRef.current?.focus()
  }

  function cancelEditing() {
    setDraft(desired)
    setEditing(false)
  }

  function confirmSave() {
    setDialogOpen(false)
    setTypedName("")
    setEditing(false)
    commit(APN_KEY, { cellularConfig: { apn: draft } })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Access Point Name (APN)</CardTitle>
        <CardDescription>
          The carrier gateway in which the cellular data connection dials
          through.
        </CardDescription>
        <CardAction>
          <ConfigStatusBadge status={configStatus.cellular} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={APN_KEY}>APN</FieldLabel>
            <div className="flex max-w-md items-center gap-2">
              <Input
                id={APN_KEY}
                ref={inputRef}
                value={draft}
                placeholder={apn?.applied ?? "as stored in the modem"}
                autoComplete="off"
                spellCheck={false}
                readOnly={!editing}
                disabled={blocked || pending}
                aria-invalid={inputError !== null}
                className={cn(
                  !editing && "cursor-default text-muted-foreground"
                )}
                onChange={(e) => setDraft(e.target.value.trim())}
              />
              {/* Read-only until Edit is clicked; Save only exists once the
                  operator has said they mean to change it. Cancel restores the
                  stored value so leaving edit mode never leaves a half-typed
                  APN sitting in the field looking authoritative. */}
              {editing ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      blocked || pending || !dirty || inputError !== null
                    }
                    onClick={() => setDialogOpen(true)}
                  >
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={cancelEditing}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="icon-sm"
                  title="Edit the APN"
                  aria-label="Edit the APN"
                  disabled={blocked || pending}
                  onClick={startEditing}
                >
                  <PencilIcon />
                </Button>
              )}
            </div>
            {inputError !== null && (
              <p className="text-destructive">{inputError}</p>
            )}
            <FieldDescription>
              In use now:{" "}
              <span className="font-medium text-foreground">
                {apn?.applied ?? "unknown"}
              </span>
              . Leave the field empty to keep the APN stored in the modem
              untouched. A change is proven with real traffic over cellular
              within a few minutes, or the device restores the previous APN by
              itself.
            </FieldDescription>
          </Field>
          {note !== null && (
            <SettingsCallout
              icon={
                note.tone === "danger" ? (
                  <AlertTriangleIcon />
                ) : (
                  <CircleDashedIcon />
                )
              }
              className={cn(
                note.tone === "danger" &&
                  "border-destructive/40 text-destructive",
                note.tone === "warn" &&
                  "border-amber-500/40 text-amber-700 dark:border-amber-400/40 dark:text-amber-400"
              )}
            >
              {note.text}
            </SettingsCallout>
          )}
          {blocked && (
            <SettingsCallout
              icon={<AlertTriangleIcon />}
              className="border-destructive/40 text-destructive"
            >
              {gate.kind === "blocked" ? gate.reason : null}
            </SettingsCallout>
          )}
          {/* The machinery note is strictly fresher and more specific than the
              status verdict (which restates it a report later) — showing both
              stacks two callouts saying the same thing. */}
          {note === null && (
            <ConfigStatusCallout status={configStatus.cellular} />
          )}
        </FieldGroup>
      </CardContent>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setTypedName("")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {clearing
                ? "Stop managing this device's APN?"
                : gate.kind === "danger"
                  ? "Change the APN of a cellular-only device?"
                  : "Change the APN?"}
            </DialogTitle>
            <DialogDescription className="space-y-2">
              {clearing ? (
                <span>
                  The device will keep whatever APN its modem currently stores
                  (&quot;{apn?.applied ?? "unknown"}&quot;) and nothing will be
                  written to it.
                </span>
              ) : gate.kind === "danger" ? (
                <span>
                  <span className="font-medium text-foreground">
                    {gate.message}
                  </span>{" "}
                  Changing the APN to &quot;{draft}&quot; will drop its
                  connection. If the new APN does not work, the device will
                  restore the previous one by itself within about 5 minutes —
                  but it will be unreachable until then, and if that recovery
                  fails it will need someone physically on site.
                </span>
              ) : (
                <span>
                  {gate.kind === "confirm" ? gate.message : null} The device
                  applies &quot;{draft}&quot; to its modem, proves it can pass
                  real traffic, and rolls back on its own if it cannot.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {gate.kind === "danger" && !clearing && (
            <div className="space-y-1">
              <FieldLabel htmlFor="apn-confirm-name">
                Type the device name to continue
              </FieldLabel>
              <Input
                id="apn-confirm-name"
                value={typedName}
                placeholder={deviceName}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setTypedName(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={
                gate.kind === "danger" && !clearing ? "destructive" : "default"
              }
              disabled={
                gate.kind === "danger" && !clearing && typedName !== deviceName
              }
              onClick={confirmSave}
            >
              {clearing ? "Keep the modem's APN" : `Apply "${draft}"`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
