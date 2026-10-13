// The device Settings tab's sub-tabs. In `lib/` rather than beside the tab
// components because things OUTSIDE the settings page need to name a tab in
// order to deep-link into it (`?tab=power`) — e.g. the live-block descriptors
// in lib/live-block.ts, which point an operator at the control that explains
// why a stream is paused.

export const SETTINGS_TABS = [
  "general",
  "interface",
  "telemetry",
  "media",
  "connectivity",
  // The vehicle OBD-II adapter (plans/obd2-bluetooth-integration): the `obd`
  // namespace plus the adapter's reported state. Shown for every device; a
  // model without `peripherals.obd` gets one explanatory line.
  "vehicle",
  "power",
  "system",
  // Cloud-side event routing (plans/xorgate-webhooks); not device config.
  "webhooks",
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  general: "General",
  interface: "Interface",
  telemetry: "Telemetry",
  media: "Media",
  connectivity: "Connectivity",
  vehicle: "Vehicle",
  power: "Power",
  system: "System",
  webhooks: "Webhooks",
}
