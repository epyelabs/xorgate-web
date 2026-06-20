import { useEffect, useState } from "react"
import {
  CheckIcon,
  CopyIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react"
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
  createDeviceRegistration,
  getDeviceRegistration,
  type DeviceRegistration,
} from "@/lib/api"

type Phase = "creating" | "pending" | "claimed" | "expired" | "error"

const POLL_INTERVAL_MS = 3000

function phaseFromStatus(status: DeviceRegistration["status"]): Phase {
  return status === "claimed" ? "claimed" : status === "expired" ? "expired" : "pending"
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  return `${m}:${String(total % 60).padStart(2, "0")}`
}

export function ProvisionDeviceDialog({
  open,
  onOpenChange,
  onClaimed,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onClaimed?: () => void
}) {
  const [phase, setPhase] = useState<Phase>("creating")
  const [reg, setReg] = useState<DeviceRegistration | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // Bumped to mint a fresh code (after expiry / error) without closing.
  const [reloadNonce, setReloadNonce] = useState(0)

  // Mint (or reuse — the endpoint is idempotent) a code whenever the dialog
  // opens or the user asks for a new one.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPhase("creating")
    setReg(null)
    setErrorMsg(null)
    setCopied(false)
    ;(async () => {
      try {
        const r = await createDeviceRegistration()
        if (cancelled) return
        setReg(r)
        setPhase(phaseFromStatus(r.status))
      } catch (err) {
        if (cancelled) return
        setErrorMsg((err as Error).message || "Failed to create registration")
        setPhase("error")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, reloadNonce])

  // Poll until the device claims the code (or it expires). reg.code is stable
  // across polls, so this effect isn't torn down on every status update.
  useEffect(() => {
    if (!open || phase !== "pending" || !reg) return
    const code = reg.code
    let cancelled = false
    const id = setInterval(async () => {
      try {
        const r = await getDeviceRegistration(code)
        if (cancelled) return
        setReg(r)
        if (r.status === "claimed" && r.deviceId) {
          setPhase("claimed")
          onClaimed?.()
        } else if (r.status === "expired") {
          setPhase("expired")
        }
      } catch {
        // transient (network / token refresh) — keep polling.
      }
    }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [open, phase, reg?.code, onClaimed])

  // 1s countdown tick, only while waiting.
  useEffect(() => {
    if (!open || phase !== "pending") return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [open, phase])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const installCommand = reg
    ? `curl -s ${reg.installUrl} -o install.sh\nsudo bash install.sh`
    : ""

  const remainingMs = reg ? new Date(reg.expiresAt).getTime() - now : 0

  async function handleCopy() {
    if (!installCommand) return
    try {
      await navigator.clipboard.writeText(installCommand)
      setCopied(true)
    } catch {
      toast.error("Failed to copy to clipboard")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Provision device</DialogTitle>
          <DialogDescription>
            SSH into the remote device and run the commands below. The agent
            will register itself and appear in this list once it phones home.
          </DialogDescription>
        </DialogHeader>

        {phase === "creating" ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Generating a one-time install command…
          </div>
        ) : phase === "error" ? (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-sm text-destructive">
              {errorMsg ?? "Could not create a registration code."}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setReloadNonce((n) => n + 1)}
            >
              <RefreshCwIcon />
              Try again
            </Button>
          </div>
        ) : phase === "claimed" ? (
          <div className="flex items-center gap-2 py-6 text-sm">
            <CheckIcon className="size-4 text-emerald-500" />
            <span className="text-foreground">
              Device connected. It now appears in your devices list.
            </span>
          </div>
        ) : phase === "expired" ? (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              This code expired before the device claimed it. Generate a new one
              to try again.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setReloadNonce((n) => n + 1)}
            >
              <RefreshCwIcon />
              Generate new code
            </Button>
          </div>
        ) : (
          <>
            <div className="relative min-w-0">
              <pre className="overflow-x-auto rounded-md bg-muted p-3 pr-10 font-mono text-xs/relaxed text-foreground">
                <code className="break-all whitespace-pre-wrap">
                  {installCommand}
                </code>
              </pre>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-2 right-2"
                onClick={handleCopy}
                aria-label="Copy install command"
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </Button>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              <span>
                Listening for the device… code expires in{" "}
                <span className="tabular-nums">
                  {formatRemaining(remainingMs)}
                </span>
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Requires sudo. The installer pulls the latest agent build and
              configures it to talk to your workspace.
            </p>
          </>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}
