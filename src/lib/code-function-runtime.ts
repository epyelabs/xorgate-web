import { z } from "zod"
import {
  DEFAULT_JS_CODE,
  DEFAULT_PY_CODE,
  FUNCTION_NODE_RUNTIMES,
} from "./code-function-mock"

// UI/UX MOCKUP — client-side "runtime" for Code Function nodes.
//
// Test runs: JavaScript actually executes in a throwaway Web Worker in the
// user's own browser (same trust boundary as devtools); Python is simulated
// with a canned result until the backend cloud runtime exists. Monitoring
// data is deterministic per node id so the monitor tab looks stable across
// reopens without any backend.

// --- Typed view over the node's loose config jsonb -----------------------------

export const functionVersionSchema = z.object({
  version: z.number(),
  code: z.string(),
  handler: z.string(),
  publishedAt: z.string(),
  description: z.string().optional(),
})
export type FunctionVersion = z.infer<typeof functionVersionSchema>

export interface FunctionConfig {
  handler: string
  timeoutMs: number
  memoryMb: number
  code: string
  /** Published snapshots, newest first. */
  versions: FunctionVersion[]
  /** Version currently "live" (mock), or null when only $LATEST exists. */
  deployedVersion: number | null
}

export function readFunctionConfig(
  catalogType: string,
  config: Record<string, unknown>,
): FunctionConfig {
  const runtime = FUNCTION_NODE_RUNTIMES[catalogType]
  const fallbackCode = runtime?.language === "python" ? DEFAULT_PY_CODE : DEFAULT_JS_CODE
  const versions = Array.isArray(config.versions)
    ? config.versions
        .map((v) => functionVersionSchema.safeParse(v))
        .filter((r) => r.success)
        .map((r) => r.data)
    : []
  return {
    handler: typeof config.handler === "string" && config.handler ? config.handler : "handler",
    timeoutMs: typeof config.timeoutMs === "number" ? config.timeoutMs : 3000,
    memoryMb: typeof config.memoryMb === "number" ? config.memoryMb : 256,
    code: typeof config.code === "string" ? config.code : fallbackCode,
    versions,
    deployedVersion:
      typeof config.deployedVersion === "number" ? config.deployedVersion : null,
  }
}

// --- Test execution ------------------------------------------------------------

export interface TestRunResult {
  ok: boolean
  /** True when the run was faked (Python) rather than executed. */
  simulated: boolean
  result?: unknown
  error?: string
  logs: string[]
  durationMs: number
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

// Static worker body: user code + handler name arrive via postMessage and are
// evaluated with `new Function`, so syntax errors surface as catchable results
// instead of killing the worker at load.
const JS_WORKER_SOURCE = `
self.onmessage = async (e) => {
  const { code, handler, event, timeoutMs } = e.data;
  const logs = [];
  const fmt = (v) => {
    if (typeof v === "string") return v;
    try { return JSON.stringify(v); } catch { return String(v); }
  };
  const log = (...args) => logs.push(args.map(fmt).join(" "));
  console.log = log; console.info = log; console.warn = log; console.error = log;
  const context = {
    log,
    functionVersion: "$LATEST",
    remainingTimeMs: () => timeoutMs,
  };
  const started = performance.now();
  try {
    const factory = new Function(
      code + "\\n;return (typeof " + handler + " === \\"function\\") ? " + handler + " : undefined;"
    );
    const fn = factory();
    if (!fn) throw new Error('Handler "' + handler + '" is not defined as a function');
    const result = await fn(event, context);
    self.postMessage({ ok: true, result, logs, durationMs: performance.now() - started });
  } catch (err) {
    self.postMessage({
      ok: false,
      error: (err && err.stack) ? String(err.stack) : String(err),
      logs,
      durationMs: performance.now() - started,
    });
  }
};
`

function runJavaScript(
  code: string,
  handler: string,
  event: unknown,
  timeoutMs: number,
): Promise<TestRunResult> {
  if (!IDENTIFIER_RE.test(handler)) {
    return Promise.resolve({
      ok: false,
      simulated: false,
      error: `Handler "${handler}" is not a valid identifier`,
      logs: [],
      durationMs: 0,
    })
  }
  const blob = new Blob([JS_WORKER_SOURCE], { type: "text/javascript" })
  const url = URL.createObjectURL(blob)
  const worker = new Worker(url)
  return new Promise((resolve) => {
    const started = performance.now()
    const cleanup = () => {
      worker.terminate()
      URL.revokeObjectURL(url)
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve({
        ok: false,
        simulated: false,
        error: `Task timed out after ${timeoutMs} ms`,
        logs: [],
        durationMs: performance.now() - started,
      })
    }, timeoutMs)
    worker.onmessage = (e) => {
      clearTimeout(timer)
      cleanup()
      resolve({ simulated: false, ...(e.data as Omit<TestRunResult, "simulated">) })
    }
    worker.onerror = (e) => {
      clearTimeout(timer)
      cleanup()
      resolve({
        ok: false,
        simulated: false,
        error: e.message || "Worker error",
        logs: [],
        durationMs: performance.now() - started,
      })
    }
    worker.postMessage({ code, handler, event, timeoutMs })
  })
}

// Python cannot run in the browser (yet) — return a shaped, clearly labelled
// simulation so the test tab UX is complete end to end.
function simulatePython(
  code: string,
  handler: string,
  event: unknown,
): Promise<TestRunResult> {
  const defined = new RegExp(`^def\\s+${handler}\\s*\\(`, "m").test(code)
  const durationMs = 40 + Math.random() * 90
  const finish = (result: TestRunResult) =>
    new Promise<TestRunResult>((resolve) => setTimeout(() => resolve(result), 350))
  if (!defined) {
    return finish({
      ok: false,
      simulated: true,
      error: `Runtime.HandlerNotFound: no function "def ${handler}(...)" in module`,
      logs: ["[simulated] Python 3.13 runtime — cloud execution mocked in this preview"],
      durationMs,
    })
  }
  const base = typeof event === "object" && event !== null ? (event as object) : { event }
  return finish({
    ok: true,
    simulated: true,
    result: { ...base, processed: true },
    logs: [
      "[simulated] Python 3.13 runtime — cloud execution mocked in this preview",
      `received event ${JSON.stringify(event)}`,
    ],
    durationMs,
  })
}

export function runTestEvent(opts: {
  catalogType: string
  code: string
  handler: string
  event: unknown
  timeoutMs: number
}): Promise<TestRunResult> {
  const runtime = FUNCTION_NODE_RUNTIMES[opts.catalogType]
  if (runtime?.language === "python") {
    return simulatePython(opts.code, opts.handler, opts.event)
  }
  return runJavaScript(opts.code, opts.handler, opts.event, opts.timeoutMs)
}

// Sample events for the test tab's template picker.
export const SAMPLE_TEST_EVENTS: { id: string; label: string; body: unknown }[] = [
  {
    id: "telemetry",
    label: "Telemetry event",
    body: {
      deviceId: "dev-4f2a",
      metric: "engine_temp_c",
      value: 92.4,
      ts: "2026-07-18T10:24:03Z",
    },
  },
  {
    id: "detection",
    label: "Model detection",
    body: {
      deviceId: "dev-4f2a",
      model: "object-detection",
      detections: [{ label: "person", confidence: 0.91, box: [120, 80, 260, 340] }],
      frameTs: "2026-07-18T10:24:03Z",
    },
  },
  { id: "empty", label: "Empty object", body: {} },
]

// --- Mock monitoring data ------------------------------------------------------

export interface MetricBucket {
  /** Hour label, e.g. "14:00". */
  hour: string
  invocations: number
  errors: number
  p50: number
  p95: number
}

export interface RecentInvocation {
  id: string
  at: string
  status: "ok" | "error"
  durationMs: number
}

export interface FunctionMetrics {
  buckets: MetricBucket[]
  totalInvocations: number
  totalErrors: number
  errorRatePct: number
  p95Ms: number
  recent: RecentInvocation[]
}

// Deterministic PRNG (mulberry32) seeded from the node id, so the monitor tab
// renders the same fake fleet history every time the same node is opened.
function seededRandom(seed: string): () => number {
  let h = 1779033703
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function mockFunctionMetrics(nodeId: string): FunctionMetrics {
  const rand = seededRandom(nodeId)
  const nowHour = new Date().getHours()
  const buckets: MetricBucket[] = []
  for (let i = 23; i >= 0; i--) {
    const hour = (nowHour - i + 24) % 24
    // Diurnal shape: quiet overnight, busy mid-day.
    const diurnal = 0.35 + 0.65 * Math.max(0, Math.sin(((hour - 5) / 15) * Math.PI))
    const invocations = Math.round(diurnal * (140 + rand() * 80))
    const errors = rand() < 0.35 ? Math.round(invocations * rand() * 0.04) : 0
    const p50 = Math.round(38 + rand() * 30)
    const p95 = Math.round(p50 * (1.8 + rand() * 1.4))
    buckets.push({
      hour: `${String(hour).padStart(2, "0")}:00`,
      invocations,
      errors,
      p50,
      p95,
    })
  }
  const totalInvocations = buckets.reduce((sum, b) => sum + b.invocations, 0)
  const totalErrors = buckets.reduce((sum, b) => sum + b.errors, 0)
  const p95Ms = Math.max(...buckets.map((b) => b.p95))

  const recent: RecentInvocation[] = []
  let offsetMs = 0
  for (let i = 0; i < 8; i++) {
    offsetMs += 30_000 + rand() * 480_000
    const failed = rand() < 0.12
    recent.push({
      id: `req-${Math.floor(rand() * 0xffffff)
        .toString(16)
        .padStart(6, "0")}`,
      at: new Date(Date.now() - offsetMs).toISOString(),
      status: failed ? "error" : "ok",
      durationMs: Math.round(35 + rand() * 160),
    })
  }

  return {
    buckets,
    totalInvocations,
    totalErrors,
    errorRatePct: totalInvocations > 0 ? (totalErrors / totalInvocations) * 100 : 0,
    p95Ms,
    recent,
  }
}
