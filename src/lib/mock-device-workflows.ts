import type { DeviceWorkflowAttachment } from "./device-workflow-schemas"

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
    trigger: "telemetry_saved",
    triggerDetail: "on telemetry save",
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
    trigger: "recording_saved",
    triggerDetail: "stream: cam0-main",
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
    trigger: "schedule",
    triggerDetail: "0 * * * * (hourly)",
    lastRunAt: null,
    lastRunStatus: null,
    runCount: 0,
    createdAt: "2026-06-20T00:00:00.000Z",
  },
]

// Static stream keys offered by the "after recording saved" trigger. A real
// build would derive these from the device model's media capabilities.
export const MOCK_STREAM_KEYS = ["cam0-main", "cam0-sub", "cam1-main"] as const
