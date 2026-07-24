#!/usr/bin/env node
// Phase 3 harness driver: exercises the PRODUCTION replay tile + clock via
// the .replay-harness page against real dev segments, in Chrome and WebKit.
// Usage: node drive-harness.mjs <chrome|webkit>
import { chromium, firefox, webkit } from "playwright"

const BASE = "http://localhost:5199"
const SOAK = "019f8b5c-8db5-7b81-88d9-917489d33e58"
const GAPS = "019f8fba-03cd-7700-95c9-23c0b1f68e46"
const CRASH = "019f8f6f-3bfc-76e3-970e-a06093ffc9e6"

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

async function load(sessionId) {
  await page.goto(`${BASE}/?m=manifests/${sessionId}.json`)
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 })
  await page.evaluate(() => {
    window.__waiting = 0
    document.querySelector("video").addEventListener("waiting", () => window.__waiting++)
  })
  return page.evaluate(() => ({
    from: window.__timeline.from,
    to: window.__timeline.to,
    gaps: window.__timeline.gaps,
    segments: window.__timeline.segments.map((s) => ({
      seq: s.seq, startTs: s.startTs, eff: s.effectiveDurationMs, finalized: s.finalized,
    })),
  }))
}

const st = () => page.evaluate(() => window.__clock.getState())
const vid = () =>
  page.evaluate(() => {
    const v = document.querySelector("video")
    const buf = []
    for (let i = 0; i < v.buffered.length; i++) buf.push([v.buffered.start(i), v.buffered.end(i)])
    return { ct: v.currentTime, ready: v.readyState, paused: v.paused, buffered: buf, rate: v.playbackRate }
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

// --- Scenario A: soak playthrough at 4x across >=5 boundaries + cold seek ---
{
  const tl = await load(SOAK)
  const r = {}
  let t0 = Date.now()
  await page.evaluate(() => { window.__clock.setRate(4); window.__clock.play() })
  r.firstFrameMs = await waitFor(async () => (await vid()).ready >= 2, 20000, "first frame")
  const target = tl.from + 5.5 * 60_000
  await waitFor(async () => (await st()).playheadTs >= target, 180000, "5 boundaries")
  r.boundariesCrossedSec = Math.round((Date.now() - t0) / 1000)
  r.waitingEvents = await page.evaluate(() => window.__waiting)
  // clock/video drift while pacing
  const [s1, v1] = [await st(), await vid()]
  r.pacingDriftMs = Math.round(Math.abs((s1.playheadTs - tl.from) - v1.ct * 1000))
  // cold seek deep into the hour
  const seekTs = tl.from + 2500_000
  t0 = Date.now()
  await page.evaluate((ts) => window.__clock.seek(ts), seekTs)
  r.coldSeekMs = await waitFor(async () => {
    const v = await vid()
    const pos = (seekTs - tl.from) / 1000
    return v.ready >= 2 && Math.abs(v.ct - pos) < 6 && v.buffered.some(([a, b]) => v.ct >= a && v.ct < b)
  }, 15000, "cold seek buffered")
  await page.evaluate(() => window.__clock.pause())
  results.scenarios.soak = r
  console.log("A soak:", JSON.stringify(r))
}

// --- Scenario B: gap skip on + free-run off on the eviction session ---
{
  const tl = await load(GAPS)
  const gap = tl.gaps[0]
  const r = { gapSec: Math.round((gap.toTs - gap.fromTs) / 1000) }
  await page.evaluate((ts) => window.__clock.seek(ts), gap.fromTs - 5000)
  await page.evaluate(() => { window.__clock.setRate(1); window.__clock.play() })
  const t0 = Date.now()
  await waitFor(async () => (await st()).playheadTs >= gap.toTs, 30000, "gap skip")
  r.skipAfterMs = Date.now() - t0
  r.lastSkip = (await st()).lastSkip
  // video resumes on the far side
  await waitFor(async () => {
    const v = await vid()
    return v.ready >= 2 && !v.paused && v.ct > (gap.toTs - tl.from) / 1000 - 1
  }, 15000, "video resume after skip")
  r.resumedFarSide = true
  await page.evaluate(() => window.__clock.pause())

  // free-run: skipGaps off
  await page.evaluate((ts) => window.__clock.seek(ts), gap.fromTs - 2000)
  await page.evaluate(() => { window.__clock.setSkipGaps(false); window.__clock.setRate(4); window.__clock.play() })
  await waitFor(async () => (await st()).playheadTs > gap.fromTs + 8000, 20000, "free-run into gap")
  const inGapState = await st()
  r.freeRunInGap = inGapState.playheadTs < gap.toTs
  r.gapOverlayShown = (await page.textContent("body")).includes("No video recorded")
  r.videoPausedInGap = (await vid()).paused
  const p1 = inGapState.playheadTs
  await sleep(2000)
  const p2 = (await st()).playheadTs
  r.freeRunRateObserved = Math.round((p2 - p1) / 2000 * 10) / 10 // expect ~4
  await page.evaluate(() => { window.__clock.setSkipGaps(true) })
  await waitFor(async () => (await st()).playheadTs >= gap.toTs, 5000, "late skip after toggle")
  r.lateToggleSkips = true
  await page.evaluate(() => window.__clock.pause())
  results.scenarios.gaps = r
  console.log("B gaps:", JSON.stringify(r))
}

// --- Scenario C: crash-cut artifact plays to its cut, no error ---
{
  const tl = await load(CRASH)
  const partial = tl.segments.find((s) => !s.finalized)
  const r = { partialSeq: partial.seq, partialEff: partial.eff }
  await page.evaluate((ts) => window.__clock.seek(ts), partial.startTs - 5000)
  await page.evaluate(() => { window.__clock.setRate(4); window.__clock.play() })
  // Reaching the cut hands the playhead back to the clock; with the partial
  // last, the replay ends (playing=false at to) — that's boundary-reached.
  await waitFor(async () => {
    const s = await st()
    return !s.playing && s.playheadTs >= partial.startTs
  }, 60000, "crash artifact end")
  r.endedAtTs = (await st()).playheadTs
  r.endedAtOffsetIntoPartialSec = Math.round((r.endedAtTs - partial.startTs) / 1000)
  r.tileError = (await page.textContent("body")).includes("buffer error")
  results.scenarios.crash = r
  console.log("C crash:", JSON.stringify(r))
}

// --- Scenario D: whole-session seek sweep (quota eviction under pressure) ---
{
  const tl = await load(SOAK)
  const r = { seeks: 0, failures: [] }
  const t0 = Date.now()
  for (let i = 0; i < 61; i += 2) { // every other segment ≈ 31 seeks / ~430 MB
    const ts = tl.from + i * 60_000 + 5000
    await page.evaluate((t) => window.__clock.seek(t), ts)
    try {
      await waitFor(async () => {
        const v = await vid()
        const pos = (ts - tl.from) / 1000
        return v.ready >= 2 && v.buffered.some(([a, b]) => pos >= a && pos < b)
      }, 20000, `seek ${i}`)
      r.seeks++
    } catch (e) {
      r.failures.push(i)
    }
  }
  r.sweepSec = Math.round((Date.now() - t0) / 1000)
  const v = await vid()
  r.bufferedTotalSec = Math.round(v.buffered.reduce((a, [s, e]) => a + (e - s), 0))
  r.bufferedRanges = v.buffered.length
  results.scenarios.sweep = r
  console.log("D sweep:", JSON.stringify(r))
}

console.log("PAGE ERRORS:", JSON.stringify(results.pageErrors))
console.log("RESULT " + JSON.stringify(results))
await browser.close()
process.exit(results.pageErrors.length || results.scenarios.sweep.failures.length ? 1 : 0)
