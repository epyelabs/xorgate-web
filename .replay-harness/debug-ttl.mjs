// Scenario E: simulate presigned-URL expiry mid-replay + silent swap.
// Break every unfetched segment URL, let a seek fail, restore, verify recovery.
import { chromium } from "playwright"
const browser = await chromium.launch({ channel: "chrome" })
const page = await browser.newPage()
await page.goto("http://localhost:5199/?m=manifests/019f8b5c-8db5-7b81-88d9-917489d33e58.json")
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 })
const tl = await page.evaluate(() => ({ from: window.__timeline.from }))
// play a bit so seg0/1 are in
await page.evaluate(() => window.__clock.play())
await new Promise((r) => setTimeout(r, 3000))
// break URLs (as if they all expired), then seek somewhere unbuffered
await page.evaluate(() => {
  window.__realUrls = window.__timeline.segments.map((s) => s.url)
  for (const s of window.__timeline.segments) s.url = s.url.replace("Signature=", "Signature=EXPIRED")
})
await page.evaluate((ts) => window.__clock.seek(ts), tl.from + 1500_000)
await new Promise((r) => setTimeout(r, 3000))
const broken = await page.evaluate(() => {
  const v = document.querySelector("video")
  const pos = 1500
  let buffered = false
  for (let i = 0; i < v.buffered.length; i++) if (pos >= v.buffered.start(i) && pos < v.buffered.end(i)) buffered = true
  return { targetBuffered: buffered }
})
// restore fresh URLs (the manifest-refresh swap) and wait for recovery via backoff retry
await page.evaluate(() => {
  window.__timeline.segments.forEach((s, i) => { s.url = window.__realUrls[i] })
})
const t0 = Date.now()
let recovered = false
while (Date.now() - t0 < 20000) {
  await new Promise((r) => setTimeout(r, 500))
  const ok = await page.evaluate(() => {
    const v = document.querySelector("video")
    const pos = 1500
    for (let i = 0; i < v.buffered.length; i++) if (pos >= v.buffered.start(i) && pos < v.buffered.end(i)) return v.readyState >= 2
    return false
  })
  if (ok) { recovered = true; break }
}
console.log(JSON.stringify({ whileBroken: broken, recoveredAfterSwapMs: recovered ? Date.now() - t0 : null }))
await browser.close()
process.exit(recovered && !broken.targetBuffered ? 0 : 1)
