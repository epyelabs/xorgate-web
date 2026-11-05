import { describe, expect, it } from "vitest"
import type { WorkflowRunDetail } from "@/lib/workflow-run-schemas"
import {
  artifactFileName,
  buildArtifactGroups,
  framesCountFor,
  inputKeysFromManifest,
  previewSeqs,
  videoNodes,
} from "./run-artifacts"

const runId = "0336f969-62cd-4b06-9add-b38ff25a1d7d"
const prefix = `workflows/v2/runs/${runId}/`

function run(over: Partial<WorkflowRunDetail> = {}): WorkflowRunDetail {
  return {
    id: runId,
    workspaceId: null,
    templateId: "t",
    templateName: "WF-Integration E2E visualize",
    templateVersion: 0,
    deviceId: null,
    deviceName: null,
    trigger: "simulation",
    mode: "simulation",
    status: "succeeded",
    startedAt: "2026-09-08T20:00:00.000Z",
    endedAt: "2026-09-08T20:00:40.000Z",
    durationMs: 40200,
    eventCount: 0,
    workspaceName: null,
    triggeredBy: "simulation",
    definition: {
      schemaVersion: 2,
      nodes: [
        { id: "vid", type: "source.video", position: { x: 0, y: 0 }, data: { label: "Video", config: {} } },
        { id: "viz", type: "output.visualization", position: { x: 0, y: 0 }, data: { label: "Annotated", config: {} } },
        { id: "cap", type: "output.data_capture", position: { x: 0, y: 0 }, data: { label: "Capture", config: {} } },
      ],
      edges: [],
    },
    steps: [
      { seq: 2, nodeId: "viz", label: "Annotated", status: "ok", output: "50 annotated frame(s)", durationMs: 900 },
    ],
    events: [],
    metrics: { nodes: 3, okSteps: 3, events: 0, messages: 0 },
    engineVersion: 2,
    artifacts: {
      eventsKey: null,
      outputs: { cap: { recordsKey: `${prefix}outputs/cap/records.jsonl`, count: 50, format: "jsonl" } },
      videos: { viz: { key: `${prefix}video/viz.mp4`, frames: 50, fps: 2 } },
    },
    error: null,
    failedNodeId: null,
    progress: null,
    ...over,
  }
}

describe("artifactFileName", () => {
  it("folds the path under the run prefix (matches the backend's Content-Disposition)", () => {
    expect(artifactFileName(runId, `${prefix}outputs/cap/records.jsonl`)).toBe("outputs-cap-records.jsonl")
    expect(artifactFileName(runId, `${prefix}video/viz.mp4`)).toBe("video-viz.mp4")
    expect(artifactFileName(runId, `${prefix}result.json`)).toBe("result.json")
  })
})

describe("previewSeqs", () => {
  it("spreads first, quartiles and last over a contiguous 0-based range", () => {
    expect(previewSeqs(50)).toEqual([0, 12, 25, 37, 49])
    expect(previewSeqs(3)).toEqual([0, 1, 2])
    expect(previewSeqs(0)).toEqual([])
  })
})

describe("framesCountFor", () => {
  it("prefers the muxed video's count, then the step summary", () => {
    expect(framesCountFor(run(), "viz")).toBe(50)
    const noVideo = run({ artifacts: { eventsKey: null, outputs: {} } })
    expect(framesCountFor(noVideo, "viz")).toBe(50)
    expect(framesCountFor(run({ steps: [] , artifacts: null }), "viz")).toBeNull()
  })
})

describe("inputKeysFromManifest", () => {
  it("finds materialized input keys wherever a binding names them", () => {
    const manifest = {
      inputs: [
        { nodeId: "n1", binding: { kind: "telemetry_history_s3", s3Key: `${prefix}inputs/n1/records.jsonl` } },
        { nodeId: "n2", binding: { kind: "video_file", s3Key: "uploads/x.mp4" } },
      ],
    }
    expect(inputKeysFromManifest(manifest, runId)).toEqual([
      { nodeId: "n1", key: `${prefix}inputs/n1/records.jsonl` },
    ])
    expect(inputKeysFromManifest({}, runId)).toEqual([])
  })
})

describe("buildArtifactGroups", () => {
  it("lists records, video, frames, inputs and the run files with their keys", () => {
    const groups = buildArtifactGroups({
      run: run(),
      definition: null,
      nodeLabels: new Map([["viz", "Annotated"], ["cap", "Capture"]]),
      manifestInputs: [{ nodeId: "n1", key: `${prefix}inputs/n1/records.jsonl` }],
    })
    expect(groups.map((g) => g.id)).toEqual(["records", "videos", "frames", "inputs", "run"])
    const byId = Object.fromEntries(groups.flatMap((g) => g.entries).map((e) => [e.id, e]))
    expect(byId["records:cap"].key).toBe(`${prefix}outputs/cap/records.jsonl`)
    expect(byId["video:viz"].meta).toBe("50 frames @ 2 fps · mp4")
    expect(byId["frames:viz"].frames).toEqual({ count: 50, previewSeqs: [0, 12, 25, 37, 49] })
    expect(byId["input:n1"].format).toBe("jsonl")
    expect(byId["result"].key).toBe(`${prefix}result.json`)
    expect(byId["manifest"].key).toBe(`${prefix}manifest.json`)
  })
  it("a telemetry-only run lists only its records/events and the run files", () => {
    const groups = buildArtifactGroups({
      run: run({
        definition: { schemaVersion: 2, nodes: [], edges: [] },
        steps: [],
        artifacts: { eventsKey: `${prefix}events.jsonl`, outputs: {} },
        events: [{ id: "e", kind: "overspeed", occurredAt: "2026-08-12T23:56:01.289Z", confidence: 1, clip: false, payloadSummary: "" }],
      }),
      definition: null,
      nodeLabels: new Map(),
      manifestInputs: [],
    })
    expect(groups.map((g) => g.id)).toEqual(["events", "run"])
    expect(groups[0].entries[0].meta).toBe("1 event with payloads")
  })
})

describe("buildArtifactGroups on a cancelled run", () => {
  it("lists only manifest.json when the row was never finalized", () => {
    const groups = buildArtifactGroups({
      // The viz step summary would otherwise synthesize a frames entry.
      run: run({ status: "cancelled", artifacts: null, error: "Cancelled by user" }),
      definition: null,
      nodeLabels: new Map(),
      manifestInputs: null,
    })
    expect(groups.map((g) => g.id)).toEqual(["run"])
    expect(groups[0].entries.map((e) => e.id)).toEqual(["manifest"])
    expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBe(1)
  })

  it("still lists what a cancelled row's artifacts name, plus result.json", () => {
    const groups = buildArtifactGroups({
      run: run({ status: "cancelled" }),
      definition: null,
      nodeLabels: new Map(),
      manifestInputs: null,
    })
    expect(groups.map((g) => g.id)).toEqual(["records", "videos", "frames", "run"])
    expect(groups.at(-1)?.entries.map((e) => e.id)).toEqual(["result", "manifest"])
  })

  it("keeps result.json for a failed run without artifacts", () => {
    const groups = buildArtifactGroups({
      run: run({ status: "failed", artifacts: null, steps: [] }),
      definition: null,
      nodeLabels: new Map(),
      manifestInputs: null,
    })
    expect(groups.map((g) => g.id)).toEqual(["run"])
    expect(groups[0].entries.map((e) => e.id)).toEqual(["result", "manifest"])
  })
})

describe("videoNodes", () => {
  const depthRun = (config: Record<string, unknown>, videos: Record<string, { key: string; frames: number; fps: number }>) =>
    run({
      definition: {
        schemaVersion: 2,
        nodes: [
          { id: "vid", type: "source.video", position: { x: 0, y: 0 }, data: { label: "Video", config: {} } },
          { id: "depth", type: "model.depth", position: { x: 0, y: 0 }, data: { label: "Depth", config } },
          { id: "seg", type: "model.segmentation", position: { x: 0, y: 0 }, data: { label: "Seg", config: {} } },
        ],
        edges: [],
      },
      steps: [{ seq: 1, nodeId: "depth", label: "Depth", status: "ok", output: "depth over 30 frame(s) (depth-anything-v2-small v1, ~900 ms/frame)", durationMs: 1 }],
      artifacts: { eventsKey: null, outputs: {}, videos },
    })

  it("lists Depth Estimation (it renders its own colormap) without a Visualization node", () => {
    const r = depthRun({}, { depth: { key: `${prefix}video/depth.mp4`, frames: 30, fps: 2 } })
    expect(videoNodes(r.definition, r)).toEqual([{ id: "depth", label: "Depth" }])
    expect(framesCountFor(r, "depth")).toBe(30)
    const groups = buildArtifactGroups({ run: r, definition: null, nodeLabels: new Map(), manifestInputs: null })
    expect(groups.find((g) => g.id === "videos")?.entries.map((e) => e.key)).toEqual([`${prefix}video/depth.mp4`])
  })

  it("reads the frame count from the depth step summary when no video was muxed", () => {
    const r = depthRun({}, {})
    expect(framesCountFor(r, "depth")).toBe(30)
  })

  it("skips Depth Estimation with renderPreview off, and nodes that render nothing", () => {
    const r = depthRun({ renderPreview: false }, {})
    expect(videoNodes(r.definition, r)).toEqual([])
  })

  it("lists any node the run recorded a video for", () => {
    const r = depthRun({ renderPreview: false }, { seg: { key: `${prefix}video/seg.mp4`, frames: 4, fps: 2 } })
    expect(videoNodes(r.definition, r).map((n) => n.id)).toEqual(["seg"])
  })
})
