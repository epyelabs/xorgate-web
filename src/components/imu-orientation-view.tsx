import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js"
import type { LatestReading } from "@xorgate/sdk"
import type { ImuView } from "@/lib/xorgate"
import { useIsDark } from "@/hooks/use-is-dark"
import {
  formatMetricValue,
  formatUnit,
  metricLabel,
} from "@/lib/telemetry-meta"

// The Argus CM5 board itself, from the CAD export, drawn as a shaded solid with
// its own feature edges over it — the same treatment the marketing site gives
// the hardware, so the device reads the same way in both places.
//
// It lives in the device body frame — the same axes the sensor reports in, so
// the board turns exactly as the real one does: +X nose-to-tail, +Y across the
// width, +Z up (component side toward +Z). The STL exports the board lying in
// its own XY plane with the long axis on Y and the components growing along +Z,
// so one -90° turn about Z is the whole correction (see `loadBoard`).

/**
 * Where the model is served from. It is a multi-megabyte download for one
 * ornament, so nothing is fetched until the panel is nearly on screen, and the
 * parsed result is cached for the rest of the page's life (see `loadBoard`).
 *
 * The `-v1` is load-bearing: the deploy sync marks everything but index.html
 * `immutable, max-age=1y`, and unlike Vite's bundle output a file in public/
 * carries no content hash. A revised board export therefore has to land under a
 * new name (`-v2`) or a year of browsers will keep serving the old one.
 */
const BOARD_URL = "/argus-cm5-board-v1.stl"

/**
 * Feature-edge threshold in degrees. The mesh is ~105k triangles, so drawing
 * every triangle edge reads as mud; at 30 degrees only the edges where two
 * faces genuinely meet survive, which is what picks out the board outline, the
 * connectors and the taller components.
 */
const EDGE_ANGLE = 30

const FOV_DEG = 45
// Default 3/4 view angle; a per-device override comes in via the `view` prop.
// The distance along the direction is derived from the aspect ratio so the
// board stays fully framed in a tall or a wide panel.
const DEFAULT_VIEW: ImuView = { azimuthDeg: 45, elevationDeg: 24 }

// Azimuth spins the camera around the board (0 = behind, 90 = right side);
// elevation raises it toward top-down. Both in degrees, three.js Y-up world.
function viewDirFrom(view: ImuView): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(view.azimuthDeg)
  const el = THREE.MathUtils.degToRad(
    Math.max(-85, Math.min(85, view.elevationDeg))
  )
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el)
  )
}

/**
 * The model, reduced to the plain typed arrays the scene needs. Deliberately
 * NOT BufferGeometry: geometries own GPU buffers and a dispose() from one
 * unmounting panel would blind the next one, whereas typed arrays are inert and
 * can be wrapped by as many short-lived geometries as the page needs.
 */
type BoardModel = {
  /** Triangle soup, 3 floats per vertex, already oriented and recentred. */
  faces: Float32Array
  /** Feature edges as line-segment pairs, in the same frame. */
  edges: Float32Array
  /** Half the bounding-box diagonal: the sphere the camera frames against. */
  radius: number
}

/**
 * The parse is the expensive half — ~105k triangles through STLLoader and then
 * through EdgesGeometry's vertex weld — and the panel remounts on every device
 * the user opens. Cache the promise at module scope so the download, the parse
 * and the edge extraction all happen once per page load; a failure clears the
 * cache so the next mount gets a fresh attempt rather than the stale rejection.
 */
let boardPromise: Promise<BoardModel> | null = null

async function buildBoard(): Promise<BoardModel> {
  const response = await fetch(BOARD_URL)
  if (!response.ok) throw new Error(`board model: ${response.status}`)
  const faces = new STLLoader().parse(await response.arrayBuffer())
  // The export lays the board out with its long axis on Y; a -90° turn about Z
  // maps that onto body +X, leaving the width on Y and the components already
  // pointing up (+Z). Flip the sign here to put the other end forward.
  faces.rotateZ(-Math.PI / 2)
  faces.computeBoundingBox()
  const box = faces.boundingBox!
  const centre = box.getCenter(new THREE.Vector3()).multiplyScalar(-1)
  faces.translate(centre.x, centre.y, centre.z)
  // EdgesGeometry welds the STL's duplicated vertices itself, so the triangle
  // soup needs no merge pass before the creases are found.
  const edges = new THREE.EdgesGeometry(faces, EDGE_ANGLE)

  // Framing against a sphere (rather than the current pose's silhouette) keeps
  // the board the same size as it turns and guarantees it never crops at any
  // orientation. The extra 8% is breathing room against the panel edges.
  const radius = 0.5 * box.getSize(new THREE.Vector3()).length() * 1.08

  const model: BoardModel = {
    // MeshBasicMaterial is unlit, so the normals STLLoader also produced are
    // dead weight; keep only the positions.
    faces: faces.getAttribute("position").array as Float32Array,
    edges: edges.getAttribute("position").array as Float32Array,
    radius,
  }
  faces.dispose()
  edges.dispose()
  return model
}

function loadBoard(): Promise<BoardModel> {
  if (!boardPromise) {
    boardPromise = buildBoard().catch((error: unknown) => {
      boardPromise = null
      throw error
    })
  }
  return boardPromise
}

// Scene palette per theme. A canvas cannot be styled by Tailwind's `dark:`
// variant, so these are applied imperatively once the theme resolves (see the
// useIsDark effect below).
//
// The steps are Tailwind's NEUTRAL ramp, not zinc: index.css defines every
// surface as `oklch(L 0 0)` — chroma zero, a true grey — whereas zinc carries a
// slight blue cast that reads as off-palette next to it.
//
// The edge is the theme's foreground (near-black on light, near-white on dark),
// which is the highest-contrast colour the design system offers: the board reads
// as strongly as the page's own text without introducing a hue the palette does
// not otherwise use. The background sits a step off the card behind it so the
// scene reads as a recessed viewport, and the face sits a step off that so the
// solid still occludes its own back edges.
//
// `bg` must stay in step with the Tailwind fallback classes on the container,
// which is what shows in the instant before the first frame renders.
const THEME_COLORS = {
  dark: {
    bg: 0x0a0a0a, // neutral-950 — matches --background
    face: 0x171717, // neutral-900 — matches --card
    edge: 0xfafafa, // neutral-50 — matches --foreground
  },
  light: {
    bg: 0xf5f5f5, // neutral-100
    face: 0xe5e5e5, // neutral-200
    edge: 0x0a0a0a, // neutral-950 — matches --foreground
  },
} as const

/**
 * Read the resolved theme straight off the DOM — the same class `useIsDark`
 * watches. The scene is built asynchronously, so the theme it has to paint
 * itself with cannot come from the effect's closure, and a ref written during
 * render is not allowed to carry it either.
 */
function resolveDark(): boolean {
  return document.documentElement.classList.contains("dark")
}

function applyTheme(
  dark: boolean,
  scene: THREE.Scene,
  face: THREE.MeshBasicMaterial,
  edge: THREE.LineBasicMaterial
) {
  const colors = dark ? THEME_COLORS.dark : THEME_COLORS.light
  ;(scene.background as THREE.Color).set(colors.bg)
  face.color.set(colors.face)
  edge.color.set(colors.edge)
}

// Exponential smoothing rate for the orientation slerp. Telemetry lands at ~1 Hz
// (the collector decimates the sensor's ~20 Hz), so the board would visibly step
// once a second if each sample were applied directly. This eases toward the
// latest sample and settles well inside the 1s window. Slerping quaternions —
// rather than lerping the euler angles — also takes the shortest path across the
// ±180° yaw wrap instead of spinning the long way round.
const SMOOTHING_LAMBDA = 6

function readAngle(latest: Record<string, LatestReading>, key: string): number {
  const v = latest[key]?.value
  return typeof v === "number" ? v : 0
}

/**
 * Live 3D orientation of the device, driven by the IMU euler stream. Renders the
 * Argus CM5 board at the device's orientation, in a scene that follows the app's
 * light/dark theme.
 *
 * Frames: the agent publishes Tait-Bryan ZYX euler angles in degrees (roll about
 * body X, pitch about Y, yaw about Z) in a Z-up body frame, while three.js is
 * Y-up. The board mesh therefore carries the raw device rotation, and a parent
 * group rotated -90° about X maps that Z-up frame into the viewer's Y-up world.
 */
export function ImuOrientationView({
  latest,
  eulerMetrics,
  view,
}: {
  latest: Record<string, LatestReading>
  // The euler metric keys this device model actually produces, in display order.
  eulerMetrics: string[]
  // Per-device camera angle (device settings); null/undefined = default 3/4 view.
  view?: ImuView | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  // The scene is built once and driven by refs: telemetry updates arrive ~4x/s
  // (the hook's flush interval), which would tear down and rebuild the renderer
  // if the orientation were an effect dependency.
  const targetQuatRef = useRef(new THREE.Quaternion())
  // Camera direction + a handle to re-run the fit, so a settings change (or the
  // device row arriving after mount) moves the camera without rebuilding the
  // scene — same reason the orientation flows through a ref above.
  const viewDirRef = useRef(viewDirFrom(view ?? DEFAULT_VIEW))
  const refitRef = useRef<(() => void) | null>(null)
  // Held so a theme change can recolour the existing scene in place. Rebuilding
  // it instead would drop the WebGL context and reset the board's smoothed
  // orientation, making it lurch back to level on every toggle.
  const sceneRef = useRef<THREE.Scene | null>(null)
  const faceMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null)
  const edgeMaterialRef = useRef<THREE.LineBasicMaterial | null>(null)
  const isDark = useIsDark()
  // "pending" until the model lands; "failed" means the panel keeps its space
  // and says so rather than sitting blank forever.
  const [modelState, setModelState] = useState<"pending" | "ready" | "failed">(
    "pending"
  )

  const roll = readAngle(latest, "imu.euler_roll")
  const pitch = readAngle(latest, "imu.euler_pitch")
  const yaw = readAngle(latest, "imu.euler_yaw")
  const hasFix = eulerMetrics.some((m) => latest[m] !== undefined)

  useEffect(() => {
    // three.js euler order "ZYX" composes as Rz(yaw)·Ry(pitch)·Rx(roll), which is
    // exactly the agent's convention (see lib/orientation.ts on the device).
    targetQuatRef.current.setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(roll),
        THREE.MathUtils.degToRad(pitch),
        THREE.MathUtils.degToRad(yaw),
        "ZYX"
      )
    )
  }, [roll, pitch, yaw])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let teardown: (() => void) | undefined

    const build = async () => {
      let model: BoardModel
      try {
        model = await loadBoard()
      } catch {
        if (!disposed) setModelState("failed")
        return
      }
      if (disposed) return

      const scene = new THREE.Scene()
      scene.background = new THREE.Color()

      const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 1, 2000)

      let renderer: THREE.WebGLRenderer
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      } catch {
        // No WebGL context available; the panel just stays empty.
        return
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      container.appendChild(renderer.domElement)
      renderer.domElement.style.display = "block"
      renderer.domElement.style.width = "100%"
      renderer.domElement.style.height = "100%"
      // The canvas is laid out by its absolutely-positioned container (see the
      // `absolute inset-0` below) so that setSize()'s width/height attributes —
      // which are the canvas's *intrinsic* size — can never feed back into the
      // page's layout. In flow they raise the container's min-content height, so
      // the view can grow but never shrink again: once the media tiles below
      // finish loading and need their space back, the column overflows.

      // Z-up (device) → Y-up (three.js).
      const frame = new THREE.Group()
      frame.rotation.x = -Math.PI / 2
      scene.add(frame)

      // Opaque faces so the board reads as a solid body: bare edges are an
      // ambiguous tangle and you cannot tell which way it is turning. The
      // polygon offset pushes the faces back a hair so the edges never z-fight.
      const faceMaterial = new THREE.MeshBasicMaterial({
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        // CAD exports are not always consistently wound, and a single inverted
        // triangle on a solid body shows as a hole straight through it.
        side: THREE.DoubleSide,
      })
      const edgeMaterial = new THREE.LineBasicMaterial()

      // Fresh geometries around the cached arrays: BufferAttribute wraps the
      // typed array as-is (Float32BufferAttribute would copy it), so every
      // panel shares one copy of the model in JS memory.
      const faceGeometry = new THREE.BufferGeometry()
      faceGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(model.faces, 3)
      )
      const edgeGeometry = new THREE.BufferGeometry()
      edgeGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(model.edges, 3)
      )

      // The board spins about its own centroid; this outer group carries the
      // device orientation quaternion, which the render loop slerps toward.
      const body = new THREE.Group()
      body.add(new THREE.Mesh(faceGeometry, faceMaterial))
      body.add(new THREE.LineSegments(edgeGeometry, edgeMaterial))
      frame.add(body)

      sceneRef.current = scene
      faceMaterialRef.current = faceMaterial
      edgeMaterialRef.current = edgeMaterial
      applyTheme(resolveDark(), scene, faceMaterial, edgeMaterial)

      // Frame the board for the current aspect: fit against whichever of the
      // vertical / horizontal fov is tighter, so it never crops in a narrow
      // panel.
      const fit = (aspect: number) => {
        const vFov = THREE.MathUtils.degToRad(FOV_DEG)
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
        const distance = Math.max(
          model.radius / Math.sin(vFov / 2),
          model.radius / Math.sin(hFov / 2)
        )
        camera.position.copy(viewDirRef.current).multiplyScalar(distance)
        camera.lookAt(0, 0, 0)
      }

      const resize = () => {
        const { clientWidth, clientHeight } = container
        if (clientWidth === 0 || clientHeight === 0) return
        const aspect = clientWidth / clientHeight
        camera.aspect = aspect
        camera.updateProjectionMatrix()
        renderer.setSize(clientWidth, clientHeight, false)
        fit(aspect)
      }
      resize()
      refitRef.current = resize

      // The panel resizes with the column (and the app sidebar collapsing),
      // which fires no window resize event.
      const observer = new ResizeObserver(resize)
      observer.observe(container)

      let frameId = 0
      let prev = performance.now()
      const tick = (now: number) => {
        const dt = Math.min((now - prev) / 1000, 0.1) // clamp after a hidden tab
        prev = now
        const ease = 1 - Math.exp(-SMOOTHING_LAMBDA * dt)
        body.quaternion.slerp(targetQuatRef.current, ease)
        renderer.render(scene, camera)
        frameId = requestAnimationFrame(tick)
      }
      frameId = requestAnimationFrame(tick)

      const dispose = () => {
        cancelAnimationFrame(frameId)
        observer.disconnect()
        refitRef.current = null
        // Only the wrappers: `model` is shared with every other panel.
        faceGeometry.dispose()
        edgeGeometry.dispose()
        faceMaterial.dispose()
        edgeMaterial.dispose()
        renderer.dispose()
        renderer.domElement.remove()
        sceneRef.current = null
        faceMaterialRef.current = null
        edgeMaterialRef.current = null
      }

      // The build is async, so the effect may already have been torn down.
      if (disposed) dispose()
      else {
        teardown = dispose
        setModelState("ready")
      }
    }

    // The model is a multi-megabyte download, so nothing is fetched until the
    // panel is nearly on screen.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        void build()
      },
      { rootMargin: "300px" }
    )
    observer.observe(container)

    return () => {
      disposed = true
      observer.disconnect()
      teardown?.()
    }
  }, [])

  // Re-aim the camera when the per-device view setting changes (or first
  // arrives — the device row usually lands after the scene has mounted).
  useEffect(() => {
    viewDirRef.current = viewDirFrom(view ?? DEFAULT_VIEW)
    refitRef.current?.()
  }, [view])

  // Recolour on theme change. The scene paints itself on creation (it may not
  // exist yet when this first runs), so this only has to handle later toggles;
  // the render loop is already continuous, so the new colours appear on the
  // next frame.
  useEffect(() => {
    const scene = sceneRef.current
    const face = faceMaterialRef.current
    const edge = edgeMaterialRef.current
    if (!scene || !face || !edge) return
    applyTheme(isDark, scene, face, edge)
  }, [isDark])

  return (
    // flex-1 so the board absorbs whatever height the IMU numbers above it and
    // the sibling cards leave, rather than stranding empty space at the bottom of
    // the column; the min-height keeps it legible if the column gets tight enough
    // to scroll instead. The border keeps the scene distinct from the card behind
    // it, which in either theme is a near-identical shade. The background here is
    // only what shows before the first frame — it mirrors THEME_COLORS[*].bg.
    <div className="relative min-h-40 w-full flex-1 overflow-hidden rounded-md border bg-neutral-100 dark:bg-neutral-950">
      {/* Absolute, so the canvas contributes nothing to layout: it is sized BY
          this box, never the other way round. `min-h-40` is then the only floor
          on how far the view can shrink. */}
      <div ref={containerRef} className="absolute inset-0" />

      {modelState !== "ready" ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          {modelState === "failed" ? "3D model unavailable" : "Loading model…"}
        </div>
      ) : !hasFix ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          Waiting for IMU…
        </div>
      ) : null}

      {/* The euler angles driving the board, so the view is readable as numbers
          too — the telemetry cards omit them for this reason. The scene follows
          the theme, so the overlay uses the ordinary semantic tokens. */}
      {eulerMetrics.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center px-2">
          <div className="pointer-events-auto flex max-w-full items-center gap-3 overflow-x-auto rounded-md border bg-background/85 px-2.5 py-1.5 shadow-sm backdrop-blur-sm">
            {eulerMetrics.map((m) => {
              const reading = latest[m]
              return (
                <div
                  key={m}
                  className="flex items-baseline gap-1.5 text-xs whitespace-nowrap"
                >
                  <span className="text-muted-foreground">
                    {metricLabel(m)}
                  </span>
                  <span className="font-medium tabular-nums">
                    {reading ? formatMetricValue(reading.value, m) : "—"}
                    {reading?.unit ? (
                      <span className="ml-0.5 font-normal text-muted-foreground">
                        {formatUnit(reading.unit)}
                      </span>
                    ) : null}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
