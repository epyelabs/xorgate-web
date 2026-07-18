import type { CatalogNode, WorkflowCatalog } from "./workflow-catalog-schemas"

// UI/UX MOCKUP — "Code Function" node category.
//
// The node catalog is normally SERVED by the backend (GET /workflow-catalog);
// these two entries are injected client-side by the workflow-catalog store so
// the palette, canvas, and function editor can be exercised before the backend
// grows a `function.*` node module. Once the backend serves types with these
// ids, the injection is skipped per-type (see mergeMockFunctionNodes) and this
// file can be deleted.

export type FunctionLanguage = "javascript" | "python"

export interface FunctionRuntimeInfo {
  language: FunctionLanguage
  /** Lambda-style runtime label shown in the editor header. */
  runtimeLabel: string
  /** Mock file name shown on the code tab. */
  fileName: string
  monacoLanguage: string
}

export const FUNCTION_NODE_RUNTIMES: Record<string, FunctionRuntimeInfo> = {
  "function.javascript": {
    language: "javascript",
    runtimeLabel: "Node.js 22 (mock)",
    fileName: "index.js",
    monacoLanguage: "javascript",
  },
  "function.python": {
    language: "python",
    runtimeLabel: "Python 3.13 (mock)",
    fileName: "handler.py",
    monacoLanguage: "python",
  },
}

export function isCodeFunctionType(catalogType: string | undefined): boolean {
  return catalogType !== undefined && catalogType in FUNCTION_NODE_RUNTIMES
}

export const DEFAULT_JS_CODE = `/**
 * Xorgate code function (JavaScript).
 *
 * Called once per JSON event arriving on the "event" input. Whatever the
 * handler returns is emitted on the "result" output; return null or
 * undefined to drop the event.
 */
async function handler(event, context) {
  context.log("received event", event)

  return {
    ...event,
    processedAt: new Date().toISOString(),
  }
}
`

export const DEFAULT_PY_CODE = `"""Xorgate code function (Python).

Called once per JSON event arriving on the "event" input. Whatever the
handler returns is emitted on the "result" output; return None to drop
the event.
"""

def handler(event, context):
    context.log("received event", event)

    return {
        **event,
        "processed": True,
    }
`

// Config schema mirrors what the backend would emit via zod-to-json-schema.
// `code`, `versions`, and `deployedVersion` are intentionally NOT listed as
// properties: they are managed by the rich function editor, not the generic
// config form.
function functionConfigSchema() {
  return {
    type: "object",
    properties: {
      handler: {
        type: "string",
        default: "handler",
        description: "Name of the exported function invoked per event.",
      },
      timeoutMs: {
        type: "integer",
        default: 3000,
        minimum: 100,
        maximum: 30000,
        description: "Per-invocation execution deadline.",
      },
      memoryMb: {
        type: "integer",
        default: 256,
        minimum: 128,
        maximum: 2048,
        description: "Memory reserved for the function runtime.",
      },
    },
  }
}

function functionPorts(): Pick<CatalogNode, "inputs" | "outputs"> {
  return {
    inputs: [
      {
        id: "event",
        label: "Event",
        channel: "json",
        cardinality: "many",
        required: true,
      },
    ],
    outputs: [
      {
        id: "result",
        label: "Result",
        channel: "json",
        cardinality: "many",
        required: false,
      },
    ],
  }
}

export const MOCK_FUNCTION_NODES: CatalogNode[] = [
  {
    type: "function.javascript",
    version: 1,
    group: "function",
    label: "JavaScript Function",
    description:
      "Run custom JavaScript against each incoming event. Edit, test, monitor, and version the code from the function editor.",
    ui: { icon: "braces", editor: "code" },
    ...functionPorts(),
    configSchema: functionConfigSchema(),
    configDefaults: {
      handler: "handler",
      timeoutMs: 3000,
      memoryMb: 256,
      code: DEFAULT_JS_CODE,
      versions: [],
      deployedVersion: null,
    },
    requires: [],
    runtime: { target: "any" },
  },
  {
    type: "function.python",
    version: 1,
    group: "function",
    label: "Python Function",
    description:
      "Run custom Python against each incoming event. Edit, test, monitor, and version the code from the function editor.",
    ui: { icon: "file-code", editor: "code" },
    ...functionPorts(),
    configSchema: functionConfigSchema(),
    configDefaults: {
      handler: "handler",
      timeoutMs: 3000,
      memoryMb: 256,
      code: DEFAULT_PY_CODE,
      versions: [],
      deployedVersion: null,
    },
    requires: [],
    runtime: { target: "any" },
  },
]

/** Append the mock function nodes, skipping any type the backend now serves. */
export function mergeMockFunctionNodes(catalog: WorkflowCatalog): WorkflowCatalog {
  const served = new Set(catalog.nodes.map((n) => n.type))
  const additions = MOCK_FUNCTION_NODES.filter((n) => !served.has(n.type))
  if (additions.length === 0) return catalog
  return { ...catalog, nodes: [...catalog.nodes, ...additions] }
}
