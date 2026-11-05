import { describe, expect, it } from "vitest"
import { XorgateError } from "@xorgate/sdk"
import type { WorkflowRunDetail } from "@/lib/workflow-run-schemas"
import {
  cancelConflict,
  defaultSaveName,
  isTerminalPhase,
  phaseForRunStatus,
} from "./simulator-phase"

const run: WorkflowRunDetail = {
  id: "0336f969-62cd-4b06-9add-b38ff25a1d7d",
  workspaceId: null,
  templateId: "t",
  templateName: "T",
  templateVersion: 0,
  deviceId: null,
  deviceName: null,
  trigger: "simulation",
  mode: "simulation",
  status: "cancelled",
  startedAt: "2026-11-05T08:00:00.000Z",
  endedAt: "2026-11-05T08:00:04.000Z",
  durationMs: 4000,
  eventCount: 0,
  workspaceName: null,
  triggeredBy: "simulation",
  definition: { schemaVersion: 2, nodes: [], edges: [] },
  steps: [],
  events: [],
  metrics: {},
  engineVersion: 2,
  artifacts: null,
  error: "Cancelled by user",
  failedNodeId: null,
}

describe("phaseForRunStatus", () => {
  it("maps every run status to its panel phase", () => {
    expect(phaseForRunStatus("running")).toBe("running")
    expect(phaseForRunStatus("succeeded")).toBe("succeeded")
    expect(phaseForRunStatus("failed")).toBe("failed")
    expect(phaseForRunStatus("cancelled")).toBe("cancelled")
  })
})

describe("isTerminalPhase", () => {
  it("is true only for landed runs", () => {
    expect(isTerminalPhase("succeeded")).toBe(true)
    expect(isTerminalPhase("failed")).toBe(true)
    expect(isTerminalPhase("cancelled")).toBe(true)
    expect(isTerminalPhase("idle")).toBe(false)
    expect(isTerminalPhase("preparing")).toBe(false)
    expect(isTerminalPhase("running")).toBe(false)
  })
})

describe("defaultSaveName", () => {
  it("formats local date and time, zero-padded", () => {
    expect(defaultSaveName(new Date(2026, 10, 5, 9, 7))).toBe(
      "Simulation 2026-11-05 09:07"
    )
    expect(defaultSaveName(new Date(2026, 0, 1, 23, 59))).toBe(
      "Simulation 2026-01-01 23:59"
    )
  })

  it("falls back to now for an invalid date", () => {
    expect(defaultSaveName(new Date("nope"))).toMatch(
      /^Simulation \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
    )
  })
})

describe("cancelConflict", () => {
  const conflict = (details?: Record<string, unknown>) =>
    new XorgateError({
      code: "RUN_NOT_RUNNING" as never,
      message: "Run is not running",
      status: 409,
      ...(details ? { details } : {}),
    })

  it("adopts the run the 409 carries", () => {
    expect(cancelConflict(conflict({ run }))).toEqual({ run })
  })

  it("asks for a re-read when the details carry no usable run", () => {
    expect(cancelConflict(conflict())).toEqual({ run: null })
    expect(cancelConflict(conflict({ run: { id: "x" } }))).toEqual({
      run: null,
    })
  })

  it("ignores other errors", () => {
    expect(
      cancelConflict(
        new XorgateError({ code: "NOT_FOUND", message: "nope", status: 404 })
      )
    ).toBeNull()
    expect(
      cancelConflict(
        new XorgateError({ code: "CONFLICT", message: "other", status: 409 })
      )
    ).toBeNull()
    expect(cancelConflict(new Error("network"))).toBeNull()
  })
})
