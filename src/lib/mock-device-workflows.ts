import type { DeviceWorkflowAttachment } from "./device-workflow-schemas"
import { METRIC_LABELS } from "./telemetry-meta"

// Dummy attachments for the device "Workflows" tab mockup. This is the single
// source of truth the in-memory API shim (`device-workflows-api.ts`) reads and
// mutates. Replacing it with real `apiRequest` calls is the only change needed
// to go live.
//
// The `deviceId` is a fixed placeholder: the shim returns this set for ANY real
// device id (the real device uuid never matches mock ids), so the tab renders
// the same fixtures regardless of which device is open. See the shim header.

const DEVICE_ID = "dev-mockup"

export const MOCK_DEVICE_ATTACHMENTS: DeviceWorkflowAttachment[] = [
  {
    id: "dwa-1",
    deviceId: DEVICE_ID,
    templateId: "wft-harsh-driving",
    templateName: "Harsh Driving — Sudden Stop",
    templateSlug: "harsh-driving-sudden-stop",
    pinnedVersion: null, // follows published (v3)
    runningVersion: 3,
    enabled: true,
    triggers: [
      {
        type: "telemetry_condition",
        combinator: "and",
        conditions: [
          { metric: "gps.speed", operator: "gt", value: 80 },
          { metric: "imu.accel_z", operator: "lt", value: -3 },
        ],
      },
    ],
    lastRunAt: "2026-06-24T05:10:00.000Z",
    lastRunStatus: "succeeded",
    runCount: 5,
    createdAt: "2026-06-10T00:00:00.000Z",
  },
  {
    id: "dwa-2",
    deviceId: DEVICE_ID,
    templateId: "wft-perimeter",
    templateName: "Perimeter Person Detect",
    templateSlug: "perimeter-person-detect",
    pinnedVersion: 2,
    runningVersion: 2,
    enabled: true,
    triggers: [
      { type: "session_completed", streamKeys: ["cam0-main", "cam1-main"] },
    ],
    lastRunAt: "2026-06-24T07:14:00.000Z",
    lastRunStatus: "running",
    runCount: 2,
    createdAt: "2026-06-12T00:00:00.000Z",
  },
  {
    id: "dwa-3",
    deviceId: DEVICE_ID,
    templateId: "wft-harsh-driving",
    templateName: "Harsh Driving — Sudden Stop",
    templateSlug: "harsh-driving-sudden-stop",
    pinnedVersion: null,
    runningVersion: 3,
    enabled: false,
    triggers: [
      {
        type: "schedule",
        cron: "0 * * * *",
        telemetryContext: { mode: "lastN", n: 500 },
        mediaContext: { mode: "lastN", n: 3 },
      },
    ],
    lastRunAt: null,
    lastRunStatus: null,
    runCount: 0,
    createdAt: "2026-06-20T00:00:00.000Z",
  },
]

// Static stream keys offered by the "after recording saved" trigger. A real
// build would derive these from the device model's media capabilities.
export const MOCK_STREAM_KEYS = ["cam0-main", "cam0-sub", "cam1-main"] as const

// Telemetry metric keys offered by the "on telemetry condition" trigger. A real
// build would derive these from the device model's IoCapabilities via
// `capability-metrics.ts`; here we expose the full known set.
export const MOCK_TELEMETRY_METRICS = Object.keys(METRIC_LABELS)
