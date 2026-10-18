import { deviceStatusKey, type DeviceStatusDotModel } from "@/lib/device-status"

// Body of the "Device status" dialog (opened from the System card dot and the
// header chip): the current state, its faults, and the colour key of every
// code (plan §7 R1d: the key lives here, not behind a replay info button).

export const APPROXIMATE_STATUS_NOTE =
  "Approximate: built from overview buckets, not exact samples."

/** Swatch + label + one-line meaning of one device status code. */
export function DeviceStatusEntry({
  code,
  label,
  color,
  meaning,
}: {
  code: number
  label: string
  color: string
  meaning: string
}) {
  return (
    <div
      data-code={code}
      className="grid grid-cols-[auto_1fr] items-start gap-x-2.5"
    >
      <span
        aria-hidden
        className="mt-1 inline-block h-2 w-5 rounded-full ring-1 ring-foreground/15"
        style={{ backgroundColor: color }}
      />
      <span className="flex flex-col">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{meaning}</span>
      </span>
    </div>
  )
}

/**
 * The colour key body: every device status code as swatch + label + meaning,
 * plus the approximation note when the runs came from overview buckets.
 */
export function DeviceStatusKeyList({
  source,
}: {
  source: "insight" | "overview" | null
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="device-status-key">
      <ul className="flex flex-col gap-2">
        {deviceStatusKey().map((s) => (
          <li key={s.code}>
            <DeviceStatusEntry {...s} />
          </li>
        ))}
      </ul>
      {source === "overview" ? (
        <p className="border-t pt-2 text-muted-foreground">
          {APPROXIMATE_STATUS_NOTE}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The dialog body: the current state (swatch, label, meaning), the faults the
 * agent reports behind it, where the reading comes from, and the colour key
 * (with the approximation note when the replay's runs came from the overview).
 */
export function DeviceStatusDetail({
  model,
  source = null,
}: {
  model: DeviceStatusDotModel
  source?: "insight" | "overview" | null
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="device-status-detail">
      <DeviceStatusEntry {...model} />
      <div className="flex flex-col gap-1">
        <span className="font-medium text-foreground">Reported faults</span>
        {model.faults.length ? (
          <ul className="list-disc pl-4 text-muted-foreground">
            {model.faults.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </div>
      <p className="border-t pt-2 text-muted-foreground">
        The state the status LED on the device is showing, reported in telemetry
        as <code>system.led_state</code>, with the faults behind it as{" "}
        <code>system.health_flags</code>.
      </p>
      <section className="flex flex-col gap-2 border-t pt-3">
        <h3 className="font-medium text-foreground">Colour key</h3>
        <DeviceStatusKeyList source={source} />
      </section>
    </div>
  )
}
