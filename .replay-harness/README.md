# Replay harness (TEMPORARY — Phase 3 verification, composite replays plan)

Mounts the PRODUCTION replay modules (timeline / clock / MSE tile / transport
bar) against a spike-dumped manifest without app auth, for Playwright-driven
verification. Not part of the app build. Delete this directory during Phase 5
hardening (or once it stops being useful).

```sh
# 1. fresh manifests (presigned URLs expire after 1 h)
cd ../../..//plans/composite-replays/spike && node dump-manifest.mjs <sessionIds…>
cp ../spike/manifests/*.json frontend/xorgate-web/.replay-harness/manifests/

# 2. serve (from frontend/xorgate-web)
npx vite --config .replay-harness/vite.config.ts   # port 5199

# 3. drive (needs `npm i playwright` somewhere, chrome channel = real Chrome)
node drive-harness.mjs chrome|webkit|firefox   # scenarios A–D
node debug-ttl.mjs                             # scenario E: URL expiry + swap
```

Phase 3 results (2026-07-24): all scenarios green in Chrome, WebKit 26,
Firefox 151 — see plans/composite-replays/PROGRESS.md Phase 3 notes.
