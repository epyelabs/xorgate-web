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
  "power",
  "system",
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  general: "General",
  interface: "Interface",
  telemetry: "Telemetry",
  media: "Media",
  connectivity: "Connectivity",
  power: "Power",
  system: "System",
}
