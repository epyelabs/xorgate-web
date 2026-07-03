import { defaultConfig, NODE_CATALOG_BY_TYPE } from "./workflow-nodes"
import type {
  Author,
  WorkflowDefinition,
  WorkflowEdgeDef,
  WorkflowNodeDef,
  WorkflowTemplateDetail,
} from "./workflow-schemas"

// Dummy data for the Workflow Templates mockup. This is the single source of
// truth the in-memory API shim (`workflow-templates-api.ts`) reads and mutates.
// Replacing it with real `apiRequest` calls is the only change needed to go live.

const VINCE: Author = {
  id: "user-vince",
  name: "Vince Elizaga",
  email: "vncelizaga@gmail.com",
}
const MIA: Author = { id: "user-mia", name: "Mia Santos", email: "mia@xorgate.io" }

// Compact builders so the graph definitions below read like the diagrams.
function node(
  id: string,
  type: string,
  x: number,
  y: number,
  config: Record<string, unknown> = {},
  label?: string,
): WorkflowNodeDef {
  return {
    id,
    type,
    position: { x, y },
    data: {
      label: label ?? NODE_CATALOG_BY_TYPE[type]?.label ?? type,
      config: { ...defaultConfig(type), ...config },
    },
  }
}

function edge(source: string, target: string): WorkflowEdgeDef {
  return { id: `e-${source}-${target}`, source, target }
}

// --- Definitions --------------------------------------------------------------

// Harsh Driving — full fusion graph (video + GPS + IMU -> composite rule -> event)
// Vertical flow: three source lanes (x) feed down (y) into a merged rule + event.
const harshDrivingV3: WorkflowDefinition = {
  nodes: [
    node("n-video", "source.video", 0, 0),
    node("n-decode", "processor.decode_sample", 0, 130),
    node("n-detect", "processor.object_detection", 0, 260),
    node("n-gps", "source.gps", 240, 0),
    node("n-speed", "processor.speed_from_gps", 240, 130),
    node("n-imu", "source.imu", 480, 0),
    node("n-decel", "processor.imu_decel", 480, 130),
    node("n-rule", "logic.composite_rule", 240, 390, { minSpeed: 15 }, "Harsh Event Rule"),
    node("n-event", "output.event", 240, 520, { kind: "harsh_brake" }),
  ],
  edges: [
    edge("n-video", "n-decode"),
    edge("n-decode", "n-detect"),
    edge("n-gps", "n-speed"),
    edge("n-imu", "n-decel"),
    edge("n-detect", "n-rule"),
    edge("n-speed", "n-rule"),
    edge("n-decel", "n-rule"),
    edge("n-rule", "n-event"),
  ],
}

// Working draft: v3 plus an alert escalation node.
const harshDrivingV4Draft: WorkflowDefinition = {
  nodes: [
    ...harshDrivingV3.nodes,
    node("n-alert", "output.alert", 480, 520, { severity: "high" }),
  ],
  edges: [...harshDrivingV3.edges, edge("n-rule", "n-alert")],
}

// Earlier history: GPS-only deceleration rule, no vision branch.
const harshDrivingV2: WorkflowDefinition = {
  nodes: [
    node("n-gps", "source.gps", 0, 0),
    node("n-speed", "processor.speed_from_gps", 0, 130),
    node("n-thresh", "logic.threshold", 0, 260, { operator: "<=", value: -0.4, unit: "g" }),
    node("n-event", "output.event", 0, 390, { kind: "harsh_brake" }),
  ],
  edges: [
    edge("n-gps", "n-speed"),
    edge("n-speed", "n-thresh"),
    edge("n-thresh", "n-event"),
  ],
}

const perimeterV2: WorkflowDefinition = {
  nodes: [
    node("n-video", "source.video", 0, 0),
    node("n-decode", "processor.decode_sample", 0, 130),
    node("n-detect", "processor.object_detection", 0, 260, { model: "rtdetr", minConfidence: 0.55 }),
    node("n-thresh", "logic.threshold", 0, 390, { operator: ">=", value: 0.55, unit: "conf" }, "Person Present"),
    node("n-event", "output.event", 0, 520, { kind: "person_at_perimeter" }),
  ],
  edges: [
    edge("n-video", "n-decode"),
    edge("n-decode", "n-detect"),
    edge("n-detect", "n-thresh"),
    edge("n-thresh", "n-event"),
  ],
}

const idleEngineV1Draft: WorkflowDefinition = {
  nodes: [
    node("n-imu", "source.imu", 0, 0),
    node("n-gps", "source.gps", 240, 0),
    node("n-fuse", "processor.sensor_fusion", 120, 130),
    node("n-rule", "logic.composite_rule", 120, 260, { combine: "all", minSpeed: 0 }, "Idle Rule"),
    node("n-alert", "output.alert", 120, 390, { severity: "low" }),
  ],
  edges: [
    edge("n-imu", "n-fuse"),
    edge("n-gps", "n-fuse"),
    edge("n-fuse", "n-rule"),
    edge("n-rule", "n-alert"),
  ],
}

// --- Templates ----------------------------------------------------------------

export const MOCK_TEMPLATES: WorkflowTemplateDetail[] = [
  {
    id: "wft-harsh-driving",
    name: "Harsh Driving — Sudden Stop",
    slug: "harsh-driving-sudden-stop",
    description: "Detects hard braking by fusing GPS deceleration with IMU spikes.",
    status: "published",
    currentVersion: 4,
    publishedVersion: 3,
    usedBy: 4,
    createdBy: VINCE,
    updatedBy: VINCE,
    createdAt: "2026-06-02T09:12:00.000Z",
    updatedAt: "2026-06-24T07:40:00.000Z",
    versions: [
      {
        id: "wftv-harsh-1",
        version: 1,
        status: "archived",
        message: "Initial GPS threshold prototype.",
        definition: harshDrivingV2,
        createdBy: VINCE,
        createdAt: "2026-06-02T09:12:00.000Z",
      },
      {
        id: "wftv-harsh-2",
        version: 2,
        status: "archived",
        message: "Tuned deceleration threshold to -0.4g.",
        definition: harshDrivingV2,
        createdBy: VINCE,
        createdAt: "2026-06-09T14:30:00.000Z",
      },
      {
        id: "wftv-harsh-3",
        version: 3,
        status: "published",
        message: "Added vision branch + sensor fusion rule.",
        definition: harshDrivingV3,
        createdBy: VINCE,
        createdAt: "2026-06-18T11:05:00.000Z",
      },
      {
        id: "wftv-harsh-4",
        version: 4,
        status: "draft",
        message: "WIP: escalate high-severity stops to an alert.",
        definition: harshDrivingV4Draft,
        createdBy: VINCE,
        createdAt: "2026-06-24T07:40:00.000Z",
      },
    ],
    usage: [
      {
        id: "wfi-1",
        name: "City fleet — safety",
        workspaceName: "Fleet Safety Pilot",
        target: "tag: city-vans (12 devices)",
        pinnedVersion: null,
        enabled: true,
        lastRunAt: "2026-06-24T06:55:00.000Z",
      },
      {
        id: "wfi-2",
        name: "Long-haul trucks",
        workspaceName: "Fleet Safety Pilot",
        target: "tag: long-haul (3 devices)",
        pinnedVersion: 3,
        enabled: true,
        lastRunAt: "2026-06-24T05:10:00.000Z",
      },
      {
        id: "wfi-3",
        name: "Driver coaching beta",
        workspaceName: "Coaching R&D",
        target: "device: DV-22198",
        pinnedVersion: 3,
        enabled: false,
        lastRunAt: "2026-06-20T18:22:00.000Z",
      },
      {
        id: "wfi-4",
        name: "Insurance telematics",
        workspaceName: "Partner — Acme Insure",
        target: "tag: pilot (8 devices)",
        pinnedVersion: null,
        enabled: true,
        lastRunAt: "2026-06-23T21:40:00.000Z",
      },
    ],
  },
  {
    id: "wft-perimeter",
    name: "Perimeter Person Detect",
    slug: "perimeter-person-detect",
    description: "Flags a person entering a fixed-camera perimeter zone.",
    status: "published",
    currentVersion: 2,
    publishedVersion: 2,
    usedBy: 1,
    createdBy: MIA,
    updatedBy: MIA,
    createdAt: "2026-05-21T13:00:00.000Z",
    updatedAt: "2026-06-15T10:18:00.000Z",
    versions: [
      {
        id: "wftv-perim-1",
        version: 1,
        status: "archived",
        message: "First detector pass.",
        definition: perimeterV2,
        createdBy: MIA,
        createdAt: "2026-05-21T13:00:00.000Z",
      },
      {
        id: "wftv-perim-2",
        version: 2,
        status: "published",
        message: "Switched to RT-DETR, raised confidence to 0.55.",
        definition: perimeterV2,
        createdBy: MIA,
        createdAt: "2026-06-15T10:18:00.000Z",
      },
    ],
    usage: [
      {
        id: "wfi-5",
        name: "Yard cameras",
        workspaceName: "Site Security",
        target: "tag: yard-cams (4 devices)",
        pinnedVersion: 2,
        enabled: true,
        lastRunAt: "2026-06-24T07:01:00.000Z",
      },
    ],
  },
  {
    id: "wft-idle-engine",
    name: "Idle Engine Detector",
    slug: "idle-engine-detector",
    description: "Detects prolonged engine idling from IMU + GPS sensor fusion.",
    status: "draft",
    currentVersion: 1,
    publishedVersion: null,
    usedBy: 0,
    createdBy: VINCE,
    updatedBy: VINCE,
    createdAt: "2026-06-21T16:45:00.000Z",
    updatedAt: "2026-06-21T16:45:00.000Z",
    versions: [
      {
        id: "wftv-idle-1",
        version: 1,
        status: "draft",
        message: "Draft — needs idle-duration tuning.",
        definition: idleEngineV1Draft,
        createdBy: VINCE,
        createdAt: "2026-06-21T16:45:00.000Z",
      },
    ],
    usage: [],
  },
]

export const MOCK_CURRENT_USER: Author = VINCE
