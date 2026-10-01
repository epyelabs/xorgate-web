import { CheckIcon, ImageOffIcon } from "lucide-react"
import type { SimulationScenario } from "@xorgate/sdk"
import { Skeleton } from "@/components/ui/skeleton"
import { formatScenarioStats } from "@/lib/device-simulation"
import { cn } from "@/lib/utils"

/**
 * The scenario catalog as a radio list of thumbnail cards. Shared by "Register
 * simulation" and the simulated device's reboot dialog, so both read the same
 * title / duration / km / max km/h line.
 */
export function ScenarioPicker({
  scenarios,
  value,
  onChange,
  loading,
  disabled,
  currentId,
}: {
  scenarios: SimulationScenario[] | undefined
  value: string | null
  onChange: (id: string) => void
  loading?: boolean
  disabled?: boolean
  /** Marked "current" (the reboot dialog's starting point). */
  currentId?: string | null
}) {
  if (loading || !scenarios) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  }
  return (
    <div
      role="radiogroup"
      aria-label="Scenario"
      className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1"
    >
      {scenarios.map((s) => {
        const selected = s.id === value
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={selected}
            data-scenario-id={s.id}
            disabled={disabled}
            onClick={() => onChange(s.id)}
            className={cn(
              "flex items-center gap-3 rounded-md border p-2 text-left transition-colors",
              "focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/50"
            )}
          >
            <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
              {s.thumbnailUrl ? (
                <img
                  src={s.thumbnailUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <ImageOffIcon className="size-4 text-muted-foreground" />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <span className="truncate">{s.title}</span>
                {currentId === s.id ? (
                  <span className="shrink-0 rounded-full border px-1.5 text-[0.65rem] font-normal text-muted-foreground">
                    current
                  </span>
                ) : null}
              </span>
              <span className="truncate text-xs text-muted-foreground tabular-nums">
                {formatScenarioStats(s)}
              </span>
            </div>
            <CheckIcon
              className={cn(
                "size-4 shrink-0 text-primary",
                selected ? "opacity-100" : "opacity-0"
              )}
            />
          </button>
        )
      })}
    </div>
  )
}
