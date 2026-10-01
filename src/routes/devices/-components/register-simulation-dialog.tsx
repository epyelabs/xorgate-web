import { useEffect, useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import {
  AlertTriangleIcon,
  CheckIcon,
  CircleIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react"
import type { Device, DeviceSimulation } from "@xorgate/sdk"
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
import { DevicePresence } from "@/components/device-presence"
import { xg, xgMessage } from "@/lib/xorgate"
import {
  HOST_STATE_LABELS,
  simulationCreateErrorMessage,
} from "@/lib/device-simulation"
import { useWorkspaceStore } from "@/store/workspace"
import { useLiveDeviceStatus } from "@/store/presence"
import {
  useDeviceSimulation,
  useSimulationScenarios,
} from "@/queries/simulations"
import { ScenarioPicker } from "./scenario-picker"

type Phase = "form" | "creating" | "created"

const MAX_NAME_LENGTH = 120

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  return `${m}:${String(total % 60).padStart(2, "0")}`
}

/**
 * "Register simulation": a device with no hardware (plans/xorgate-device-simulator).
 *
 * Unlike "Register device" there is nothing to install. One create call makes
 * and provisions the device server-side; the simulator host then starts its
 * container within a pass, so after the create the dialog turns into a status
 * panel that follows the host's report and the device's own presence until it
 * is online.
 */
export function RegisterSimulationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const workspaceName = useWorkspaceStore(
    (s) => s.workspaces.find((w) => w.id === s.currentWorkspaceId)?.name ?? null
  )
  const [phase, setPhase] = useState<Phase>("form")
  const [name, setName] = useState("")
  const [scenarioId, setScenarioId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [created, setCreated] = useState<{
    device: Device
    simulation: DeviceSimulation
    at: number
  } | null>(null)

  const catalog = useSimulationScenarios({ enabled: open })
  const scenarios = catalog.data?.scenarios

  // Fresh form every time the dialog opens; a finished create is not resumed.
  useEffect(() => {
    if (!open) return
    setPhase("form")
    setName("")
    setScenarioId(null)
    setErrorMsg(null)
    setCreated(null)
  }, [open])

  // Default the pick once the catalog lands.
  useEffect(() => {
    if (scenarioId === null && catalog.data) {
      setScenarioId(catalog.data.defaultScenarioId)
    }
  }, [catalog.data, scenarioId])

  async function handleCreate() {
    if (!workspaceId || !scenarioId) return
    setPhase("creating")
    setErrorMsg(null)
    try {
      const trimmed = name.trim()
      const result = await xg().devices.simulations.create({
        workspaceId,
        scenarioId,
        ...(trimmed ? { name: trimmed } : {}),
      })
      setCreated({ ...result, at: Date.now() })
      setPhase("created")
      onCreated?.()
    } catch (err) {
      setErrorMsg(simulationCreateErrorMessage(err, xgMessage(err)))
      setPhase("form")
    }
  }

  const selectedTitle =
    scenarios?.find((s) => s.id === created?.simulation.scenarioId)?.title ??
    created?.simulation.scenarioId

  return (
    <Dialog
      open={open}
      onOpenChange={phase === "creating" ? undefined : onOpenChange}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Register simulation</DialogTitle>
          <DialogDescription>
            A simulated device replays a recorded drive on a loop: live video,
            a moving map pin and five recorded sessions, with no hardware.
            {workspaceName ? (
              <>
                {" "}
                It is created in{" "}
                <span className="font-medium text-foreground">
                  {workspaceName}
                </span>
                .
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {phase === "created" && created ? (
          <SimulationStatusPanel
            device={created.device}
            initial={created.simulation}
            createdAt={created.at}
            scenarioTitle={selectedTitle ?? ""}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="simulation-name">
                Name{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </FieldLabel>
              <Input
                id="simulation-name"
                value={name}
                maxLength={MAX_NAME_LENGTH}
                placeholder="Simulator SIM-…"
                disabled={phase === "creating"}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>Scenario</FieldLabel>
              {catalog.error && !catalog.data ? (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <span>{xgMessage(catalog.error)}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void catalog.refetch()}
                  >
                    <RefreshCwIcon />
                    Retry
                  </Button>
                </div>
              ) : (
                <ScenarioPicker
                  scenarios={scenarios}
                  loading={catalog.isPending}
                  value={scenarioId}
                  onChange={setScenarioId}
                  disabled={phase === "creating"}
                />
              )}
            </Field>
            {errorMsg ? (
              <p
                role="alert"
                data-testid="simulation-create-error"
                className="flex items-start gap-2 text-sm text-destructive"
              >
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                {errorMsg}
              </p>
            ) : null}
          </FieldGroup>
        )}

        {phase === "created" ? null : (
          <DialogFooter>
            <Button
              variant="outline"
              disabled={phase === "creating"}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              variant="brand"
              disabled={phase === "creating" || !scenarioId || !workspaceId}
              onClick={handleCreate}
            >
              {phase === "creating" ? (
                <>
                  <Loader2Icon className="animate-spin" />
                  Creating…
                </>
              ) : (
                "Create simulation"
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

type Step = "done" | "active" | "todo" | "error"

function StepRow({ state, label, detail }: { state: Step; label: string; detail?: string | null }) {
  return (
    <li className="flex items-start gap-2 text-sm" data-step-state={state}>
      <span className="mt-0.5 shrink-0">
        {state === "done" ? (
          <CheckIcon className="size-4 text-emerald-500" />
        ) : state === "active" ? (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        ) : state === "error" ? (
          <AlertTriangleIcon className="size-4 text-destructive" />
        ) : (
          <CircleIcon className="size-4 text-muted-foreground/40" />
        )}
      </span>
      <span className="flex flex-col">
        <span className={state === "todo" ? "text-muted-foreground" : "text-foreground"}>
          {label}
        </span>
        {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </li>
  )
}

/**
 * After the create: three steps, each driven by a real signal. Created is the
 * 201; "starting" is the host's own report (`hostState`); "online" is the
 * device itself, either its live MQTT presence or the host saying the agent in
 * the container is connected (`running`), whichever lands first.
 */
function SimulationStatusPanel({
  device,
  initial,
  createdAt,
  scenarioTitle,
  onDone,
}: {
  device: Device
  initial: DeviceSimulation
  createdAt: number
  scenarioTitle: string
  onDone: () => void
}) {
  const live = useLiveDeviceStatus(device)
  const watched = useMemo(() => [device.id], [device.id])
  const online = live?.status === "online"
  const simQuery = useDeviceSimulation(device.id, { fast: !online })
  const sim = simQuery.data ?? initial
  const isOnline = online || sim.hostState === "running"
  const failed = sim.hostState === "error"

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (isOnline || failed) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isOnline, failed])

  const hostStep: Step = failed
    ? "error"
    : isOnline || sim.hostState === "starting"
      ? "done"
      : "active"
  const onlineStep: Step = isOnline
    ? "done"
    : failed
      ? "todo"
      : sim.hostState === "starting"
        ? "active"
        : "todo"

  return (
    <div className="flex flex-col gap-4" data-testid="simulation-status-panel">
      <DevicePresence deviceIds={watched} />
      <ol className="flex flex-col gap-3">
        <StepRow
          state="done"
          label={`Created ${device.name ?? device.serial}`}
          detail={`${device.serial} · ${scenarioTitle}`}
        />
        <StepRow
          state={hostStep}
          label={
            failed
              ? "The simulator host could not start it"
              : hostStep === "done"
                ? "Simulator host picked it up"
                : HOST_STATE_LABELS[sim.hostState]
          }
          detail={sim.hostMessage}
        />
        <StepRow
          state={onlineStep}
          label="Online"
          detail={
            isOnline
              ? "Recorded sessions appear under Media Recordings over the next few minutes."
              : null
          }
        />
      </ol>
      {!isOnline && !failed ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          Usually online within a minute or two · {formatElapsed(now - createdAt)}
        </p>
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Close
        </Button>
        <Button asChild variant={isOnline ? "brand" : "outline"}>
          <Link to="/devices/$id" params={{ id: device.id }} onClick={onDone}>
            Open device
          </Link>
        </Button>
      </DialogFooter>
    </div>
  )
}
