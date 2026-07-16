import { useEffect, useRef } from "react"
import * as THREE from "three"
import type { LatestReading } from "@/hooks/use-iot-telemetry"
import { useIsDark } from "@/hooks/use-is-dark"
import { formatMetricValue, formatUnit, metricLabel } from "@/lib/telemetry-meta"

// Device body dimensions in millimetres, which double as world units here (the
// scene has no other scale to reconcile with). The BNO085 sits in the board
// plane with +Z normal to the PCB, so the 17mm thickness runs along body Z.
const BODY_LENGTH_X = 100
const BODY_WIDTH_Y = 58
const BODY_THICKNESS_Z = 17

// Radius of the box's bounding sphere plus a little headroom. Framing against
// the bounding sphere (rather than the silhouette of the current pose) keeps the
// box the same size as it turns and guarantees it never crops at any orientation.
const FIT_RADIUS =
  0.5 * Math.hypot(BODY_LENGTH_X, BODY_WIDTH_Y, BODY_THICKNESS_Z) * 1.08
const FOV_DEG = 45
// Fixed 3/4 view direction; the distance along it is derived from the aspect
// ratio so the box stays fully framed in a tall or a wide panel.
const VIEW_DIR = new THREE.Vector3(1, 0.62, 1).normalize()

// Scene palette per theme. A canvas cannot be styled by Tailwind's `dark:`
// variant, so these are applied imperatively once the theme resolves (see the
// useIsDark effect below).
//
// The steps are Tailwind's NEUTRAL ramp, not zinc: index.css defines every
// surface as `oklch(L 0 0)` — chroma zero, a true grey — whereas zinc carries a
// slight blue cast that reads as off-palette next to it.
//
// The edge is the theme's foreground (near-black on light, near-white on dark),
// which is the highest-contrast colour the design system offers: the box reads
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

// Exponential smoothing rate for the orientation slerp. Telemetry lands at ~1 Hz
// (the collector decimates the sensor's ~20 Hz), so the box would visibly step
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
 * Live 3D orientation of the device, driven by the IMU euler stream. Renders a
 * wireframe box at the device's real dimensions, in a scene that follows the
 * app's light/dark theme.
 *
 * Frames: the agent publishes Tait-Bryan ZYX euler angles in degrees (roll about
 * body X, pitch about Y, yaw about Z) in a Z-up body frame, while three.js is
 * Y-up. The box mesh therefore carries the raw device rotation, and a parent
 * group rotated -90° about X maps that Z-up frame into the viewer's Y-up world.
 */
export function ImuOrientationView({
  latest,
  eulerMetrics,
}: {
  latest: Record<string, LatestReading>
  // The euler metric keys this device model actually produces, in display order.
  eulerMetrics: string[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  // The scene is built once and driven by refs: telemetry updates arrive ~4x/s
  // (the hook's flush interval), which would tear down and rebuild the renderer
  // if the orientation were an effect dependency.
  const targetQuatRef = useRef(new THREE.Quaternion())
  // Held so a theme change can recolour the existing scene in place. Rebuilding
  // it instead would drop the WebGL context and reset the box's smoothed
  // orientation, making it lurch back to level on every toggle.
  const sceneRef = useRef<THREE.Scene | null>(null)
  const faceMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null)
  const edgeMaterialRef = useRef<THREE.LineBasicMaterial | null>(null)
  const isDark = useIsDark()

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

    const scene = new THREE.Scene()
    // Colours are applied by the theme effect below, which runs on mount too.
    scene.background = new THREE.Color()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 1, 2000)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    } catch {
      return // no WebGL context available; the panel just stays empty
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

    const geometry = new THREE.BoxGeometry(
      BODY_LENGTH_X,
      BODY_WIDTH_Y,
      BODY_THICKNESS_Z
    )
    // Opaque-ish faces so the box reads as a solid slab: a bare wireframe is an
    // ambiguous Necker cube, and you cannot tell which way it is turning. The
    // polygon offset pushes the faces back a hair so the edges never z-fight.
    const faceMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    })
    const edgesGeometry = new THREE.EdgesGeometry(geometry)
    const edgeMaterial = new THREE.LineBasicMaterial()
    faceMaterialRef.current = faceMaterial
    edgeMaterialRef.current = edgeMaterial

    const body = new THREE.Group()
    body.add(new THREE.Mesh(geometry, faceMaterial))
    body.add(new THREE.LineSegments(edgesGeometry, edgeMaterial))
    frame.add(body)

    // Frame the box for the current aspect: fit against whichever of the
    // vertical / horizontal fov is tighter, so it never crops in a narrow panel.
    const fit = (aspect: number) => {
      const vFov = THREE.MathUtils.degToRad(FOV_DEG)
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
      const distance = Math.max(
        FIT_RADIUS / Math.sin(vFov / 2),
        FIT_RADIUS / Math.sin(hFov / 2)
      )
      camera.position.copy(VIEW_DIR).multiplyScalar(distance)
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

    // The panel resizes with the column (and the app sidebar collapsing), which
    // fires no window resize event.
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    let frameId = 0
    let prev = performance.now()
    const tick = (now: number) => {
      const dt = Math.min((now - prev) / 1000, 0.1) // clamp after a hidden tab
      prev = now
      body.quaternion.slerp(
        targetQuatRef.current,
        1 - Math.exp(-SMOOTHING_LAMBDA * dt)
      )
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      geometry.dispose()
      edgesGeometry.dispose()
      faceMaterial.dispose()
      edgeMaterial.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      sceneRef.current = null
      faceMaterialRef.current = null
      edgeMaterialRef.current = null
    }
  }, [])

  // Recolour on theme change. Declared after the setup effect so the refs are
  // populated by the time this first runs on mount; the render loop is already
  // continuous, so the new colours appear on the next frame.
  useEffect(() => {
    const scene = sceneRef.current
    const face = faceMaterialRef.current
    const edge = edgeMaterialRef.current
    if (!scene || !face || !edge) return
    const colors = isDark ? THEME_COLORS.dark : THEME_COLORS.light
    ;(scene.background as THREE.Color).set(colors.bg)
    face.color.set(colors.face)
    edge.color.set(colors.edge)
  }, [isDark])

  return (
    // flex-1 so the box absorbs whatever height the IMU numbers above it and the
    // sibling cards leave, rather than stranding empty space at the bottom of the
    // column; the min-height keeps it legible if the column gets tight enough to
    // scroll instead. The border keeps the scene distinct from the card behind
    // it, which in either theme is a near-identical shade. The background here is
    // only what shows before the first frame — it mirrors THEME_COLORS[*].bg.
    <div className="relative min-h-40 w-full flex-1 overflow-hidden rounded-md border bg-neutral-100 dark:bg-neutral-950">
      {/* Absolute, so the canvas contributes nothing to layout: it is sized BY
          this box, never the other way round. `min-h-40` is then the only floor
          on how far the view can shrink. */}
      <div ref={containerRef} className="absolute inset-0" />

      {!hasFix ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          Waiting for IMU…
        </div>
      ) : null}

      {/* The euler angles driving the box, so the view is readable as numbers
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
