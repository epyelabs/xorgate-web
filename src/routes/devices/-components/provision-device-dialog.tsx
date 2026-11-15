import { useCallback, useEffect, useRef, useState } from "react"
import { CheckIcon, CopyIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
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
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { DeviceModel, DeviceRegistration } from "@xorgate/sdk"
import { xg, xgMessage } from "@/lib/xorgate"
import {
  createRegistration,
  fetchAgentChannel,
  getRegistration,
  isAgentNotEnabled,
  isCm4Model,
  registrationMatchesPick,
  rustOption,
  RUST_HINT_CM4,
  RUST_REASON_FLAG_OFF,
  RUST_REASON_OLD_API,
  type AgentChannel,
  type AgentKind,
  type AgentRegistration,
  type RustOption,
} from "@/lib/agent-channel"
import { cn } from "@/lib/utils"

type Phase = "creating" | "pending" | "claimed" | "expired" | "error"

const POLL_INTERVAL_MS = 3000

function phaseFromStatus(status: DeviceRegistration["status"]): Phase {
  return status === "claimed"
    ? "claimed"
    : status === "expired"
      ? "expired"
      : "pending"
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
  const [reg, setReg] = useState<AgentRegistration | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // Optional model pin (cm4-support D3 override). "auto" = probe-at-claim maps
  // the device's own hardware to a model row, which is the normal path; picking
  // a model re-pins the pending code so the claim honors it instead. There is
  // no un-pin — generate a new code to return to automatic.
  const [models, setModels] = useState<DeviceModel[] | null>(null)
  const [modelPick, setModelPick] = useState("auto")
  const [pinned, setPinned] = useState(false)

  // Which agent the code installs (dual-agent registration D6). JS is the
  // default until the cutover (Q-8.15). Each agent gets its OWN code: the
  // endpoint reuses a pending code only for the same agent (Q-8.2), so going
  // back to JS hands back the JS code that was already on screen.
  const [pick, setPick] = useState<AgentKind>("js")
  // The Rust channel (`?agent=rust`): undefined while checking, null when the
  // check failed. Rust is offered only when it echoes `agent: 'rust'`.
  const [rustChannel, setRustChannel] = useState<
    AgentChannel | null | undefined
  >(undefined)
  // A create that came back AGENT_NOT_ENABLED is the authoritative "no".
  const [rustRefused, setRustRefused] = useState(false)
  const rust = rustOption(rustChannel, rustRefused)
  // What to mint next. Bumping `n` mints again (after expiry / error, or for a
  // different agent) without closing the dialog.
  // Bumped by every mint and every model re-pin: a re-pin answer applies only
  // if nothing replaced the code on screen while it was in flight.
  const regSeq = useRef(0)
  const [mintReq, setMintReq] = useState<{
    agent: AgentKind
    modelId?: string
    n: number
  }>({ agent: "js", n: 0 })

  useEffect(() => {
    if (!open || models !== null) return
    let cancelled = false
    ;(async () => {
      try {
        const catalog = await xg().deviceModels.list()
        if (!cancelled) setModels(catalog)
      } catch {
        if (!cancelled) setModels([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, models])

  // Reset on CLOSE, not on open: the next open then mints for JS straight
  // away, instead of first minting for whatever agent the last session left.
  function handleOpenChange(next: boolean) {
    if (!next) {
      regSeq.current++
      setPick("js")
      setModelPick("auto")
      setPinned(false)
      setRustRefused(false)
      setRustChannel(undefined)
      setMintReq((m) => ({ agent: "js", n: m.n + 1 }))
    }
    onOpenChange(next)
  }

  // Ask once per open whether this stage and workspace can register Rust.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const channel = await fetchAgentChannel("rust")
        if (!cancelled) setRustChannel(channel)
      } catch {
        if (!cancelled) setRustChannel(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  async function handleModelPick(value: string) {
    setModelPick(value)
    if (value === "auto" || phase !== "pending") return
    const seq = ++regSeq.current
    try {
      // The endpoint is idempotent and RE-PINS the pending code in place —
      // the code for the agent on screen, so the agent travels with the pin.
      const r = await createRegistration({ agent: pick, deviceModelId: value })
      // An agent switch (or a later pin, or a close) since this was sent makes
      // the answer stale: it is the OLD agent's code, and applying it would
      // put that code on screen under the new pick (review-wp-c S2).
      if (seq !== regSeq.current) return
      setReg(r)
      setPinned(true)
    } catch (err) {
      toast.error(xgMessage(err))
    }
  }

  const handleAgentPick = useCallback(
    (agent: AgentKind) => {
      if (agent === pick) return
      setPick(agent)
      setMintReq((m) => ({
        agent,
        modelId: modelPick === "auto" ? undefined : modelPick,
        n: m.n + 1,
      }))
    },
    [pick, modelPick]
  )

  function handleRegenerate() {
    setModelPick("auto")
    setPinned(false)
    setMintReq((m) => ({ agent: pick, n: m.n + 1 }))
  }

  // Mint (or reuse — the endpoint is idempotent per agent) a code whenever the
  // dialog opens, the operator switches agent, or asks for a new one.
  useEffect(() => {
    if (!open) return
    // Supersedes any model re-pin still in flight for the previous code.
    regSeq.current++
    let cancelled = false
    setPhase("creating")
    setReg(null)
    setErrorMsg(null)
    setCopied(false)
    ;(async () => {
      try {
        const r = await createRegistration({
          agent: mintReq.agent,
          deviceModelId: mintReq.modelId,
        })
        if (cancelled) return
        setReg(r)
        if (mintReq.modelId) setPinned(true)
        setPhase(phaseFromStatus(r.status))
      } catch (err) {
        if (cancelled) return
        if (mintReq.agent === "rust" && isAgentNotEnabled(err)) {
          // The stage flag said no for this workspace: disable Rust with the
          // reason and fall back to the default, so the dialog stays usable.
          setRustRefused(true)
          toast.error(`${RUST_REASON_FLAG_OFF}. Showing the JS installer.`)
          setPick("js")
          setMintReq((m) => ({ agent: "js", modelId: m.modelId, n: m.n + 1 }))
          return
        }
        setErrorMsg(xgMessage(err) || "Failed to create registration")
        setPhase("error")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, mintReq])

  // The M1 echo guard (D6.2): the command only when the code serves the agent
  // picked. A missing `agent` (an old backend) counts as JS, so the default
  // flow is exactly today's; a Rust pick there never matches and shows none.
  const commandMatchesPick = registrationMatchesPick(reg, pick)

  // Poll until the device claims the code (or it expires). reg.code is stable
  // across polls, so this effect isn't torn down on every status update. No
  // poll while no command is shown: nothing can claim a code nobody was given.
  useEffect(() => {
    if (!open || phase !== "pending" || !reg || !commandMatchesPick) return
    const code = reg.code
    let cancelled = false
    const id = setInterval(async () => {
      try {
        const r = await getRegistration(code)
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
  }, [open, phase, reg?.code, commandMatchesPick, onClaimed])

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

  const installCommand =
    reg && commandMatchesPick
      ? `curl -s ${reg.installUrl} -o install.sh\nsudo bash install.sh`
      : ""

  const remainingMs = reg ? new Date(reg.expiresAt).getTime() - now : 0

  const pickedModel =
    modelPick === "auto" ? null : (models ?? []).find((m) => m.id === modelPick)
  const cm4Picked = isCm4Model(pickedModel)

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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Register device</DialogTitle>
          <DialogDescription>
            SSH into the remote device and run the commands below. The agent
            will register itself and appear in this list once it phones home.
          </DialogDescription>
        </DialogHeader>

        {phase !== "claimed" ? (
          <AgentPicker
            pick={pick}
            onPick={handleAgentPick}
            busy={phase === "creating"}
            rust={rust}
            cm4Picked={cm4Picked}
          />
        ) : null}

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
              onClick={handleRegenerate}
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
              onClick={handleRegenerate}
            >
              <RefreshCwIcon />
              Generate new code
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Label
                htmlFor="register-model-pick"
                className="shrink-0 text-xs text-muted-foreground"
              >
                Device model
              </Label>
              <Select value={modelPick} onValueChange={handleModelPick}>
                <SelectTrigger
                  id="register-model-pick"
                  className="h-8 flex-1 text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="auto"
                    disabled={pinned}
                    title={
                      pinned
                        ? "Already pinned — generate a new code to return to automatic"
                        : undefined
                    }
                  >
                    Automatic (detect from hardware)
                  </SelectItem>
                  {(models ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} · {m.sku}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!commandMatchesPick ? (
              <p
                className="text-sm text-destructive"
                data-testid="agent-echo-mismatch"
              >
                {pick === "rust"
                  ? `${RUST_REASON_OLD_API} yet. Pick JS to register this device.`
                  : "This code installs a different agent than the one picked. Generate a new code."}
              </p>
            ) : (
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
            )}
            {/* Nothing to wait for while no command is shown. */}
            {commandMatchesPick ? (
              <>
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
                  Requires sudo. The installer pulls the latest{" "}
                  {pick === "rust" ? "Rust " : ""}agent build and configures it
                  to talk to your workspace.
                </p>
                <AgentNote pick={pick} rustOffered={rust.state === "enabled"} />
              </>
            ) : null}
          </>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

/**
 * JS or Rust (D6.1). A two-option radio group rather than a select: both
 * options and the reason one is unavailable should be visible at a glance.
 */
function AgentPicker({
  pick,
  onPick,
  busy,
  rust,
  cm4Picked,
}: {
  pick: AgentKind
  onPick: (agent: AgentKind) => void
  busy: boolean
  rust: RustOption
  cm4Picked: boolean
}) {
  const rustDisabled = rust.state !== "enabled"
  const options: {
    value: AgentKind
    label: string
    disabled: boolean
    title?: string
  }[] = [
    { value: "js", label: "JS", disabled: false },
    {
      value: "rust",
      label: "Rust",
      disabled: rustDisabled,
      title:
        rust.state === "disabled"
          ? rust.reason
          : rust.state === "checking"
            ? "Checking whether this stage offers the Rust agent…"
            : cm4Picked
              ? RUST_HINT_CM4
              : undefined,
    },
  ]
  // Roving focus (WAI-ARIA radio group): only the checked option is in the tab
  // order, and the arrow keys move AND select, skipping unavailable options.
  // Unavailable / busy options are aria-disabled rather than natively disabled
  // so focus is never dropped mid-mint and the reason stays describable.
  const buttons = useRef<Partial<Record<AgentKind, HTMLButtonElement | null>>>(
    {}
  )
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0
    if (dir === 0) return
    e.preventDefault()
    if (busy) return
    const from = options.findIndex((o) => o.value === pick)
    for (let k = 1; k <= options.length; k++) {
      const next =
        options[
          (((from + dir * k) % options.length) + options.length) %
            options.length
        ]
      if (next.disabled) continue
      if (next.value !== pick) onPick(next.value)
      buttons.current[next.value]?.focus()
      return
    }
  }
  const reasonId = "register-agent-rust-reason"
  const cm4Id = "register-agent-rust-cm4"
  const showCm4 = pick === "rust" && cm4Picked
  const rustDescribedBy =
    [rust.state === "disabled" ? reasonId : null, showCm4 ? cm4Id : null]
      .filter(Boolean)
      .join(" ") || undefined
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span
          id="register-agent-pick-label"
          className="shrink-0 text-xs text-muted-foreground"
        >
          Agent
        </span>
        <div
          role="radiogroup"
          aria-labelledby="register-agent-pick-label"
          aria-describedby={rustDescribedBy}
          onKeyDown={handleKeyDown}
          className="inline-flex items-center rounded-md border border-border p-0.5"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={pick === opt.value}
              aria-disabled={opt.disabled || busy || undefined}
              aria-describedby={
                opt.value === "rust" ? rustDescribedBy : undefined
              }
              tabIndex={pick === opt.value ? 0 : -1}
              ref={(el) => {
                buttons.current[opt.value] = el
              }}
              data-testid={`agent-pick-${opt.value}`}
              title={opt.title}
              onClick={() => {
                if (opt.disabled || busy) return
                onPick(opt.value)
              }}
              className={cn(
                "rounded px-3 py-1 text-xs transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
                pick === opt.value
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      {rust.state === "disabled" ? (
        <p
          id={reasonId}
          className="text-xs text-muted-foreground"
          data-testid="rust-unavailable-reason"
        >
          Rust: {rust.reason}.
        </p>
      ) : null}
      {showCm4 ? (
        <p
          id={cm4Id}
          className="text-xs text-amber-600 dark:text-amber-400"
          data-testid="rust-cm4-hint"
        >
          {RUST_HINT_CM4}.
        </p>
      ) : null}
    </div>
  )
}

/** The switching notes (D1.3, Q-8.14) under whichever agent is picked. */
function AgentNote({
  pick,
  rustOffered,
}: {
  pick: AgentKind
  rustOffered: boolean
}) {
  if (pick === "rust") {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-testid="agent-note-rust"
      >
        Re-registering a device that already runs the Rust agent? Change the
        second line to{" "}
        <code className="font-mono">sudo bash install.sh --reprovision</code>.
        The Rust installer refuses a device that runs the JS agent.
      </p>
    )
  }
  // Only where Rust devices can exist: on a stage without the Rust installer
  // the JS dialog stays exactly as it was.
  if (!rustOffered) return null
  return (
    <p className="text-xs text-muted-foreground" data-testid="agent-note-js">
      Device currently runs the Rust agent? This switches it to JS. The Rust
      files stay behind, inert; remove them with{" "}
      <code className="font-mono">
        sudo /opt/xorgate-rs/provision-rs.sh --uninstall
      </code>
      .
    </p>
  )
}
