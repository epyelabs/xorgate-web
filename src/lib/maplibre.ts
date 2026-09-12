import { setWorkerUrl, type Map as MapLibreMap } from "maplibre-gl"
// maplibre 6 picks its worker file with a runtime dev/prod conditional, which
// no bundler can statically rewrite: the production build referenced
// `/assets/maplibre-gl-worker.mjs` without ever emitting it, so the deployed
// map died with a 404 while `vite dev` (which serves node_modules) worked.
// `?worker&url` compiles the worker as its own self-contained entry (plain
// `?url` copies the file verbatim, leaving its relative import of
// maplibre-gl-shared.mjs dangling) and hands us the real URL to pin here,
// before any map instantiates.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"

/**
 * Everything every map in this app must agree on, in one module — because the
 * worker pin is a MODULE SIDE EFFECT and has to have run before the first map
 * is constructed. A second map component that forgot to import it would render
 * a live, pannable basemap that silently fetches no tiles.
 *
 * Import this from any file that mounts a MapLibre map.
 */

setWorkerUrl(maplibreWorkerUrl)

// Token-free vector basemaps, one per theme. Swapping these two URLs is the
// whole job of moving to a commercial tile provider later.
export const LIGHT_STYLE = "https://tiles.openfreemap.org/styles/positron"
export const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark"

export function basemapStyle(isDark: boolean): string {
  return isDark ? DARK_STYLE : LIGHT_STYLE
}

/**
 * The id to insert overlays BEFORE, so they sit under the basemap's labels.
 *
 * Resolved against whichever style is actually loaded, never hard-coded. The
 * two basemaps do not share layer ids — positron's first label layer is
 * `waterway_line_label`, dark's is `water_name` — and MapLibre REFUSES to add
 * a layer whose `beforeId` does not exist. That is what made every geofence
 * polygon (and the 3D buildings with them) vanish in dark mode: not a contrast
 * problem, the layers were never added at all.
 *
 * `undefined` when a style has no symbol layers, which draws the overlay on
 * top — visible, which is the right way to fail here.
 */
export function firstSymbolLayerId(map: MapLibreMap): string | undefined {
  return map.getStyle()?.layers?.find((layer) => layer.type === "symbol")?.id
}
