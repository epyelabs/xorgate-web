#!/usr/bin/env node
// Phase 4 harness driver: exercises the PRODUCTION useReplayTelemetry hook +
// StreamsView (card) against real dev segments AND a DB-dumped raw telemetry
// ground truth, via the .replay-harness page. Scenarios:
//   A load + overview tier (route trace, payload log)
//   B sync spot-checks at 3 playheads vs raw DB rows
//   C playback 1x/4x: re-render rate, no readout blanking, bounded calls
//   D telemetry-hole honesty (absent metrics, hidden marker)
//   E scrub storm: bounded API call rate + correct recovery
// Usage: PW_DIR=<dir with node_modules/playwright> node drive-telemetry.mjs [chrome|webkit|firefox]
import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const req = createRequire(
  path.join(process.env.PW_DIR ?? process.cwd(), "package.json")
)
const { chromium, webkit, firefox } = req("playwright")

const BASE = "http://localhost:5199"
const GAPS = "019f8fba-03cd-7700-95c9-23c0b1f68e46"

// Mirror of the hook's staleness cutoffs (lib/replay/replay-telemetry.ts).
const CUTOFF = { imu: 2500, gps: 5000, system: 10000, lte: 60000 }
const SPOT_METRICS = [
  "imu.accel_x",
  "imu.quat_r",
  "gps.lat",
  "gps.speed",
  "system.cpu_temp",
  "lte.rssi",
]

const engine = process.argv[2] ?? "chrome"
const browser =
  engine === "webkit"
    ? await webkit.launch()
    : engine === "firefox"
      ? await firefox.launch()
      : await chromium.launch({ channel: "chrome" })

const results = { engine, scenarios: {}, pageErrors: [] }
const ctx = await browser.newContext()
const page = await ctx.newPage()
page.on("pageerror", (e) => results.pageErrors.push(String(e)))
page.on("console", (m) => {
  if (m.type() === "error") results.pageErrors.push(`console: ${m.text()}`)
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return Date.now() - t0
    await sleep(100)
  }
  throw new Error(`timeout waiting for ${label}`)
}

// Ground truth: the same dump the in-page server uses.
const dump = JSON.parse(
  await readFile(path.join(HERE, "telemetry/ntp-cam0-raw.json"), "utf8")
)
const byMetric = new Map()
for (const r of dump.rows) {
  if (r.value === null) continue
  let arr = byMetric.get(r.metric)
  if (!arr) byMetric.set(r.metric, (arr = []))
  arr.push({ ts: Date.parse(r.ts), value: r.value })
}
function expectedAt(metric, ts) {
  const arr = byMetric.get(metric)
  if (!arr) return null
  let lo = 0,
    hi = arr.length - 1,
    ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid].ts <= ts) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  if (ans === -1) return null
  const cutoff = CUTOFF[metric.split(".")[0]] ?? 30000
  if (ts - arr[ans].ts > cutoff) return null
  return arr[ans]
}

const getTelemetry = () =>
  page.evaluate(() => {
    const t = window.__telemetry
    return {
      loading: t.loading,
      error: t.error,
      hasGps: t.hasGps,
      latest: t.latest,
      position: t.position,
      course: t.course,
      routeLineCount: t.routeLines.length,
      routePts: t.routeLines.reduce((n, l) => n + l.length, 0),
      traveledLineCount: t.traveledLines.length,
      traveledPts: t.traveledLines.reduce((n, l) => n + l.length, 0),
    }
  })
const calls = () => page.evaluate(() => window.__telemetryCalls.length)
const seek = (ts) => page.evaluate((v) => window.__clock.seek(v), ts)
const dashCount = () =>
  page.evaluate(
    () => (document.body.innerText.match(/—/g) ?? []).length
  )

// --- Scenario A: load + overview tier ---
let tl
{
  await page.goto(
    `${BASE}/?m=manifests/${GAPS}.json&t=telemetry/ntp-cam0-raw.json`
  )
  await waitFor(
    () =>
      page.evaluate(
        () =>
          window.__ready === true &&
          window.__telemetry !== null &&
          window.__telemetry.loading === false &&
          window.__telemetry.error === null
      ),
    30000,
    "overview loaded"
  )
  tl = await page.evaluate(() => ({
    from: window.__timeline.from,
    to: window.__timeline.to,
    gaps: window.__timeline.gaps,
  }))
  const t = await getTelemetry()
  const log = await page.evaluate(() => window.__telemetryCalls)
  const overviewCalls = log.filter((c) => c.interval !== undefined)
  results.scenarios.A = {
    hasGps: t.hasGps,
    routeLineCount: t.routeLineCount,
    routePts: t.routePts,
    overview: overviewCalls.map((c) => ({
      metrics: c.metric.split(",").length,
      group: c.metric.split(".")[0],
      interval: c.interval,
      rows: c.rows,
      kb: Math.round(c.bytes / 1024),
      truncated: c.truncated,
      serviceMs: Math.round(c.serviceMs),
    })),
    pass: t.hasGps && t.routeLineCount >= 2 && t.routePts > 500,
  }
}

// --- Scenario B: sync spot-checks vs raw DB rows ---
{
  const points = [300_000, 900_000, 1_500_000].map((o) => tl.from + o)
  const checks = []
  for (const ts of points) {
    await seek(ts)
    // let the high-res window land (fake-server latency 400 ms + margin)
    await sleep(1300)
    const t = await getTelemetry()
    for (const m of SPOT_METRICS) {
      const exp = expectedAt(m, ts)
      const got = t.latest[m] ?? null
      const ok = exp
        ? got !== null &&
          Math.abs(got.value - exp.value) < 1e-9 &&
          got.ts === exp.ts
        : got === null
      checks.push({ offsetS: (ts - tl.from) / 1000, metric: m, ok, exp, got })
    }
    // gps.course has caps but zero recorded rows → must be absent + null course
    const t2 = await getTelemetry()
    checks.push({
      offsetS: (ts - tl.from) / 1000,
      metric: "gps.course(absent)",
      ok: !("gps.course" in t2.latest) && t2.course === null,
    })
  }
  results.scenarios.B = {
    failed: checks.filter((c) => !c.ok),
    total: checks.length,
    pass: checks.every((c) => c.ok),
  }
}

// --- Scenario C: playback re-render rate + no blanking + bounded calls ---
{
  await seek(tl.from + 60_000)
  await sleep(1300)
  const r0 = await page.evaluate(() => window.__viewRenders)
  await page.evaluate(() => {
    window.__clock.setRate(1)
    window.__clock.play()
  })
  await sleep(10_000)
  const r1 = await page.evaluate(() => window.__viewRenders)
  const rendersPerSec1x = (r1 - r0) / 10

  // 4x for 60 s of media: sample latest every 200 ms for blanking
  const c0 = await calls()
  await page.evaluate(() => window.__clock.setRate(4))
  const blanks = []
  const t0 = Date.now()
  while (Date.now() - t0 < 15_000) {
    const s = await page.evaluate(() => ({
      ts: window.__clock.getState().playheadTs,
      has: "imu.accel_x" in window.__telemetry.latest,
    }))
    if (!s.has) blanks.push(Math.round((s.ts - tl.from) / 1000))
    await sleep(200)
  }
  await page.evaluate(() => window.__clock.pause())
  const c1 = await calls()
  // Blanks are legit inside the recorded telemetry hole; anything else is a
  // window-refetch falling behind.
  const holeFrom = Date.parse("2026-07-23T16:12:27.900Z")
  const holeTo = Date.parse("2026-07-23T16:16:27.940Z")
  const badBlanks = blanks.filter((offS) => {
    const ts = tl.from + offS * 1000
    return ts < holeFrom + 2500 || ts > holeTo + 400
  })
  results.scenarios.C = {
    rendersPerSec1x,
    blanksObserved: blanks.length,
    badBlanks,
    windowCallsDuring4x60s: c1 - c0,
    pass:
      rendersPerSec1x >= 5 &&
      rendersPerSec1x <= 15 &&
      badBlanks.length === 0 &&
      c1 - c0 <= 20,
  }
}

// --- Scenario D: telemetry-hole honesty ---
{
  // Hole measured in the DB: 16:12:27.9 → 16:16:27.9 UTC (~241 s, all groups).
  const holeCenter = Date.parse("2026-07-23T16:14:30Z")
  await seek(holeCenter)
  await sleep(1300)
  const t = await getTelemetry()
  const dashes = await dashCount()
  results.scenarios.D = {
    latestKeys: Object.keys(t.latest),
    position: t.position,
    dashes,
    traveledPts: t.traveledPts,
    pass:
      Object.keys(t.latest).length === 0 &&
      t.position === null &&
      dashes >= 20,
  }
}

// --- Scenario E: scrub storm → bounded calls + correct recovery ---
{
  const c0 = await calls()
  for (let i = 0; i < 20; i++) {
    await seek(tl.from + Math.floor(((i * 7919) % 1700) * 1000))
    await sleep(150)
  }
  const cStorm = (await calls()) - c0
  const finalTs = tl.from + 1_234_000
  await seek(finalTs)
  await sleep(1500)
  const cTotal = (await calls()) - c0
  const t = await getTelemetry()
  const exp = expectedAt("imu.accel_x", finalTs)
  const got = t.latest["imu.accel_x"] ?? null
  const recovered = exp
    ? got !== null && Math.abs(got.value - exp.value) < 1e-9
    : got === null
  results.scenarios.E = {
    seeks: 21,
    callsDuringStorm: cStorm,
    callsTotal: cTotal,
    naiveWouldBe: 21 * 4,
    recovered,
    pass: cTotal <= 45 && recovered,
  }
}

results.pass =
  Object.values(results.scenarios).every((s) => s.pass) &&
  results.pageErrors.length === 0
console.log(JSON.stringify(results, null, 2))
await browser.close()
process.exit(results.pass ? 0 : 1)
