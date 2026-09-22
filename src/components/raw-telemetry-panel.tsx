import { useEffect, useRef, useState } from "react"
import { PauseIcon, PlayIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { JsonPanelShell, StatusDot } from "@/components/json-panel"
import { cn } from "@/lib/utils"
import { useRawTelemetry, type RawTelemetryStatus } from "@/hooks/use-raw-telemetry"

// Same idiom as the video tiles' status dot: green connected, amber (pulsing)
// for transient states, red for error.
const STATUS_META: Record<
  RawTelemetryStatus,
  { label: string; dot: string; pulse: boolean }
> = {
  idle: { label: "Idle", dot: "bg-zinc-300", pulse: false },
  connecting: { label: "Connecting", dot: "bg-amber-400", pulse: true },
  connected: { label: "Subscribed", dot: "bg-green-500", pulse: false },
  closed: { label: "Reconnecting", dot: "bg-amber-400", pulse: true },
  error: { label: "Error", dot: "bg-red-500", pulse: false },
}

// Reads `seq` / `ts` off the frame for the header WITHOUT validating it: this
// view must render whatever arrives, including a payload that no longer matches
// the schema (which is the interesting case). A missing or oddly-typed field
// just doesn't get a header chip.
function headerFacts(frame: unknown): { seq: number | null; ts: number | null } {
  if (typeof frame !== "object" || frame === null) return { seq: null, ts: null }
  const f = frame as Record<string, unknown>
  return {
    seq: typeof f.seq === "number" ? f.seq : null,
    ts: typeof f.ts === "number" ? f.ts : null,
  }
}

function Age({ receivedAt }: { receivedAt: number | null }) {
  // Ticks on its own so the age stays honest when frames STOP arriving — that
  // silence is the signal, and a value that freezes at "0s ago" would hide it.
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  if (receivedAt === null) return null
  const secs = Math.max(0, Math.round((Date.now() - receivedAt) / 1000))
  return <span className={cn(secs > 5 && "text-amber-600")}>{secs}s ago</span>
}

/**
 * The device's live telemetry frame, rendered as the JSON that came off the
 * wire (Raw view, prototype). Everything else in the app shows the FLATTENED
 * reading set — `gps.lat` and friends, accumulated across frames — so this is
 * the only place `v`, `deviceId`, `seq` and the real `metrics` group nesting
 * are visible, and the only place you can see a single message in isolation.
 */
export function RawTelemetryPanel({ deviceId }: { deviceId: string }) {
  const { frame, topic, receivedAt, status, error } = useRawTelemetry(deviceId)

  // Paused freezes what is DISPLAYED; the socket keeps running underneath, so
  // resuming jumps to the current frame instead of replaying a backlog. At 1 Hz
  // an unpaused pane cannot be read or text-selected, so this is load-bearing.
  const [paused, setPaused] = useState(false)
  const frozen = useRef<{ frame: unknown; receivedAt: number | null } | null>(null)
  if (!paused) frozen.current = { frame, receivedAt }
  const shown = paused && frozen.current ? frozen.current : { frame, receivedAt }

  const { seq, ts } = headerFacts(shown.frame)
  const meta = STATUS_META[status]

  return (
    <JsonPanelShell
      value={shown.frame}
      header={
        <>
          <span className="flex items-center gap-1.5 font-medium">
            <StatusDot className={meta.dot} pulse={meta.pulse} />
            {meta.label}
          </span>

          {/* The topic is worth surfacing: which plane a frame arrives on tells
              you whether the device has learned its tenant yet. */}
          {topic ? (
            <span className="truncate font-mono text-muted-foreground">
              {topic}
            </span>
          ) : null}

          <span className="ml-auto flex items-center gap-3 text-muted-foreground">
            {seq !== null ? <span>seq {seq}</span> : null}
            {ts !== null ? (
              <span className="hidden sm:inline">
                {new Date(ts).toISOString()}
              </span>
            ) : null}
            <Age receivedAt={shown.receivedAt} />
          </span>
        </>
      }
      actions={
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onClick={() => setPaused((p) => !p)}
          disabled={shown.frame === null}
        >
          {paused ? (
            <PlayIcon className="size-3.5" />
          ) : (
            <PauseIcon className="size-3.5" />
          )}
          {paused ? "Resume" : "Pause"}
        </Button>
      }
      empty={
        status === "error"
          ? (error ?? "Could not subscribe to this device's telemetry.")
          : "Waiting for a telemetry frame. Nothing is retained on this topic, so the first one arrives on the device's next publish (about a second while it is online)."
      }
    />
  )
}
