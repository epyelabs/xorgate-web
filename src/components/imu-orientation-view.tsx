import { useEffect, useRef } from "react"
import * as THREE from "three"
import type { LatestReading } from "@xorgate/sdk"
import type { ImuView } from "@/lib/api"
import { useIsDark } from "@/hooks/use-is-dark"
import {
  formatMetricValue,
  formatUnit,
  metricLabel,
} from "@/lib/telemetry-meta"

// The car lives in the device body frame — the same axes the sensor reports in,
// so the model turns exactly as the board does: +X nose-to-tail, +Y across the
// width, +Z up (roof toward +Z). The body is a single smooth hull LOFTED through
// cross-sections along the length — curved fenders, a raked windshield, a
// falling roofline and flared wheel arches — and it is drawn as the loft's own
// quad grid (section rings + lengthwise stringers), the classic dense-mesh
// "wireframe render" look, rather than only its sharp edges. Spoked wheels
// (which roll at the GPS ground speed — see the tick loop), door mirrors, a
// shark-fin antenna and a grille finish the read. The BNO085
// defines the frame; the car is just a friendlier stand-in for a bare slab when
// reading orientation at a glance.

const NOSE_X = 50
const TAIL_X = -50

// Wheels: chunky cylinders whose default +Y axis already runs along the car's
// width, dressed with a rim barrel, radial spokes and a hub on the outboard
// face so they read as wheels rather than bare discs.
const AXLE_X = 32.5 // half the wheelbase, from the car's centre (short overhangs)
const AXLE_Y = 19.5 // half the track, tucked just inside the arch flares
const AXLE_Z = 5.5 // wheel-centre height; the tyres poke a little below the sills
const WHEEL_RADIUS = 11
const WHEEL_THICKNESS = 8
const WHEEL_SEGMENTS = 28
const RIM_RADIUS = 7.2
const SPOKE_COUNT = 7
const ARCH_RADIUS = 12.5 // the underside lifts into an arch of this radius

// Loft resolution: stations along the length × points around each half section.
// This is the wireframe density — the grid IS the art style, so it is far
// denser than occlusion alone would need.
const N_STATIONS = 44
const TUMBLEHOME_SAMPLES = 4 // bezier samples up the side glass, per half ring

function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * The hull's driving dimensions at station `x`: plan half-width, underside
 * height, beltline and the top surface (hood / roof) with its half-width.
 * Everything is a smooth function of x, so the loft is continuous — the hood
 * region simply has its "roof" a couple of units above the beltline (a crowned
 * hood), and the windshield is where zTop sweeps up between the two.
 */
function hullParams(x: number) {
  const t = (x - TAIL_X) / (NOSE_X - TAIL_X) // 0 at the tail → 1 at the nose

  // Plan view: widest just behind centre, tapering to rounded ends, with a
  // flare swelling over each wheel arch.
  let wBody = 24 * (1 - 0.16 * ((t - 0.45) / 0.55) ** 2)
  for (const ax of [AXLE_X, -AXLE_X]) {
    const f = Math.max(0, 1 - ((x - ax) / 15) ** 2)
    wBody += 1.4 * f * f
  }
  wBody *= 1 - 0.12 * smoothstep01(46, NOSE_X, x)
  wBody *= 1 - 0.1 * smoothstep01(-46, TAIL_X, x)

  // Underside: flat between the wheels, rising at both bumpers (approach /
  // departure angles), and lifted into a semicircular arch over each axle —
  // that lifted rim is what draws the fender arch outline.
  let zFloor =
    3.5 + 4.5 * smoothstep01(40, NOSE_X, x) + 4 * smoothstep01(-42, TAIL_X, x)
  for (const ax of [AXLE_X, -AXLE_X]) {
    const d2 = ARCH_RADIUS ** 2 - (x - ax) ** 2
    if (d2 > 0) zFloor = Math.max(zFloor, AXLE_Z + Math.sqrt(d2))
  }

  const zBelt = 21 + 3.4 * (1 - t) // beltline rises toward the tail
  const ws = smoothstep01(17, -2, x) // 0 on the hood → 1 behind the windshield
  const zTop =
    zBelt +
    2.8 + // crowned hood sits just above the fender line
    16.5 * ws - // windshield sweeps up to the roof
    5.5 * smoothstep01(-6, -38, x) - // roofline falls toward the tail
    8 * smoothstep01(-40, TAIL_X, x) // raked tailgate glass
  const wTop = wBody * (0.86 - 0.16 * ws) // tumblehome: glass narrower than body

  return { wBody, zFloor, zBelt, zTop, wTop }
}

/**
 * One half cross-section (y ≥ 0) at station `x`, bottom centre → top centre.
 * Fixed point count at every station so consecutive rings can be stitched into
 * quads. Side heights are fractions of floor→belt so the section stays valid
 * even where the arch lifts the floor most of the way to the beltline.
 */
function halfSection(x: number): [number, number][] {
  const { wBody, zFloor, zBelt, zTop, wTop } = hullParams(x)
  const side = (f: number) => zFloor + (zBelt - zFloor) * f
  const pts: [number, number][] = [
    [0, zFloor],
    [0.5 * wBody, side(0.05)],
    [0.85 * wBody, side(0.16)],
    [0.98 * wBody, side(0.5)],
    [wBody, side(0.8)], // widest point of the body side
    [0.96 * wBody, zBelt], // belt crease
    [1.03 * wTop, zBelt + 1.0], // shoulder shelf inward to the glass
  ]
  // Tumblehome: a shallow outward-bowed curve up the glass to the roof edge.
  const p0: [number, number] = [wTop, zBelt + 1.5]
  const p2: [number, number] = [0.8 * wTop, Math.max(zTop - 0.8, zBelt + 2.1)]
  const c: [number, number] = [1.02 * wTop, (p0[1] + p2[1]) / 2]
  for (let i = 0; i <= TUMBLEHOME_SAMPLES; i++) {
    const u = i / TUMBLEHOME_SAMPLES
    const w = (1 - u) * (1 - u)
    const v = 2 * u * (1 - u)
    const q = u * u
    pts.push([w * p0[0] + v * c[0] + q * p2[0], w * p0[1] + v * c[1] + q * p2[1]])
  }
  pts.push([0.45 * wTop, zTop + 0.5]) // roof curls over…
  pts.push([0, zTop + 0.9]) // …to a gently crowned centre
  return pts
}

/**
 * Loft the hull: sweep the section through every station, stitch quads for the
 * occluding solid (plus flat caps at nose and tail), and emit the grid — every
 * section ring and every lengthwise stringer — as line segments.
 */
function buildHull(): { faces: THREE.BufferGeometry; lines: THREE.BufferGeometry } {
  const rings: number[][][] = []
  for (let i = 0; i <= N_STATIONS; i++) {
    const x = TAIL_X + ((NOSE_X - TAIL_X) * i) / N_STATIONS
    const half = halfSection(x)
    const ring: number[][] = half.map(([y, z]) => [x, y, z])
    for (let j = half.length - 2; j >= 1; j--)
      ring.push([x, -half[j][0], half[j][1]])
    rings.push(ring)
  }
  const P = rings[0].length

  const positions: number[] = []
  for (const ring of rings) for (const p of ring) positions.push(p[0], p[1], p[2])
  const index: number[] = []
  for (let i = 0; i < rings.length - 1; i++)
    for (let j = 0; j < P; j++) {
      const a = i * P + j
      const b = i * P + ((j + 1) % P)
      const c = (i + 1) * P + j
      const d = (i + 1) * P + ((j + 1) % P)
      index.push(a, b, c, b, d, c)
    }
  // Flat caps: fan each end ring around its centroid.
  for (const end of [0, rings.length - 1]) {
    const ring = rings[end]
    const cx = ring.reduce((s, p) => s + p[0], 0) / P
    const cy = ring.reduce((s, p) => s + p[1], 0) / P
    const cz = ring.reduce((s, p) => s + p[2], 0) / P
    const centroid = positions.length / 3
    positions.push(cx, cy, cz)
    for (let j = 0; j < P; j++)
      index.push(end * P + j, end * P + ((j + 1) % P), centroid)
  }
  const faces = new THREE.BufferGeometry()
  faces.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  faces.setIndex(index)

  const seg: number[] = []
  for (const ring of rings)
    for (let j = 0; j < P; j++)
      seg.push(...ring[j], ...ring[(j + 1) % P])
  for (let j = 0; j < P; j++)
    for (let i = 0; i < rings.length - 1; i++)
      seg.push(...rings[i][j], ...rings[i + 1][j])
  const lines = new THREE.BufferGeometry()
  lines.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3))

  return { faces, lines }
}

/**
 * Connect an ordered run of [x, y, z] points into line segments — used for the
 * feature lines that lie ON the hull surface (sunroof outline, hood cutlines,
 * wipers), which sample zTop so they follow the skin.
 */
function polyline(pts: number[][], close = false): THREE.BufferGeometry {
  const seg: number[] = []
  for (let i = 0; i < pts.length - 1; i++) seg.push(...pts[i], ...pts[i + 1])
  if (close) seg.push(...pts[pts.length - 1], ...pts[0])
  const geom = new THREE.BufferGeometry()
  geom.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3))
  return geom
}

/**
 * A rectangle of line segments in the y/z plane at fixed `x` — the grille and
 * intake mesh on the front fascia (ny/nz cells), or with ny = nz = 1 just a
 * rectangular outline (headlights).
 */
function panelGrid(
  x: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  ny: number,
  nz: number
): THREE.BufferGeometry {
  const seg: number[] = []
  for (let i = 0; i <= ny; i++) {
    const y = y0 + ((y1 - y0) * i) / ny
    seg.push(x, y, z0, x, y, z1)
  }
  for (let j = 0; j <= nz; j++) {
    const z = z0 + ((z1 - z0) * j) / nz
    seg.push(x, y0, z, x, y1, z)
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3))
  return geom
}

const FOV_DEG = 45
// Default 3/4 view angle (matches the pre-configurable (1, 0.62, 1) direction);
// a per-device override comes in via the `view` prop. The distance along the
// direction is derived from the aspect ratio so the car stays fully framed in
// a tall or a wide panel.
const DEFAULT_VIEW: ImuView = { azimuthDeg: 45, elevationDeg: 24 }

// Azimuth spins the camera around the car (0 = behind, 90 = right side);
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

// Scene palette per theme. A canvas cannot be styled by Tailwind's `dark:`
// variant, so these are applied imperatively once the theme resolves (see the
// useIsDark effect below).
//
// The steps are Tailwind's NEUTRAL ramp, not zinc: index.css defines every
// surface as `oklch(L 0 0)` — chroma zero, a true grey — whereas zinc carries a
// slight blue cast that reads as off-palette next to it.
//
// The edge is the theme's foreground (near-black on light, near-white on dark),
// which is the highest-contrast colour the design system offers: the car reads
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
// (the collector decimates the sensor's ~20 Hz), so the car would visibly step
// once a second if each sample were applied directly. This eases toward the
// latest sample and settles well inside the 1s window. Slerping quaternions —
// rather than lerping the euler angles — also takes the shortest path across the
// ±180° yaw wrap instead of spinning the long way round.
const SMOOTHING_LAMBDA = 6

// Wheel spin from GPS speed. The model has no intrinsic scale, so pin the
// 100-unit body to a ~4.7 m SUV and derive the tyre's rolling radius from
// that; gps.speed arrives in km/h at the same ~1 Hz cadence as the euler
// angles, so the render loop eases toward it with the same lambda and
// integrates the spin angle per frame.
const CAR_LENGTH_M = 4.7
const WHEEL_RADIUS_M = WHEEL_RADIUS * (CAR_LENGTH_M / (NOSE_X - TAIL_X))

function readAngle(latest: Record<string, LatestReading>, key: string): number {
  const v = latest[key]?.value
  return typeof v === "number" ? v : 0
}

/**
 * Extrude a side-profile drawn in the length/height plane across `width`. The
 * extrude grows along shape-local +Z, so a +90° rotation about X lands height on
 * body +Z (roof up) and the extrude depth on body Y; a shift then centres the
 * width on the axis.
 */
function extrudeProfile(shape: THREE.Shape, width: number): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: false,
  })
  geom.rotateX(Math.PI / 2)
  geom.translate(0, width / 2, 0)
  return geom
}

/**
 * Build the SUV as a group of solid faces (for occlusion) plus wireframe
 * lines, all expressed in the device body frame so the parent groups can rotate
 * it directly. The hull carries its explicit loft grid; the detail parts
 * (wheels, mirrors, fin) use EdgesGeometry at a per-part threshold. Returns the
 * group and the radius of a sphere that encloses it, used to frame the camera.
 *
 * The whole car is recentred on its own centroid so the device rotation spins it
 * in place rather than swinging it about the profile's origin.
 *
 * The wheels come back as their own groups, built about their axle centres and
 * positioned at the hubs, so the render loop can spin them about body Y (the
 * axle axis) to match the GPS ground speed.
 */
function buildCar(
  faceMaterial: THREE.Material,
  edgeMaterial: THREE.Material
): { group: THREE.Group; radius: number; wheels: THREE.Group[] } {
  const faceGeoms: THREE.BufferGeometry[] = []
  const lineGeoms: THREE.BufferGeometry[] = []
  // A face geometry whose wireframe comes from its own edges.
  const detail = (geom: THREE.BufferGeometry, thresholdDeg: number) => {
    faceGeoms.push(geom)
    lineGeoms.push(new THREE.EdgesGeometry(geom, thresholdDeg))
  }

  const hull = buildHull()
  faceGeoms.push(hull.faces)
  lineGeoms.push(hull.lines)

  // Wheels: a tyre barrel (threshold below the 360/28 ≈ 13° between facets, so
  // every tread line draws), a rim barrel, and radial spokes plus a hub on the
  // outboard face for the turbine-rim look. Each wheel's parts are built about
  // the wheel's own centre and parented to a group positioned at the hub, so
  // rotating the group about its local Y (the cylinder/axle axis) spins the
  // wheel in place.
  const wheels: THREE.Group[] = []
  for (const sx of [AXLE_X, -AXLE_X]) {
    for (const sy of [AXLE_Y, -AXLE_Y]) {
      const out = Math.sign(sy)
      const wheel = new THREE.Group()
      wheel.position.set(sx, sy, AXLE_Z)
      const wheelPart = (geom: THREE.BufferGeometry, thresholdDeg: number) => {
        wheel.add(new THREE.Mesh(geom, faceMaterial))
        wheel.add(
          new THREE.LineSegments(
            new THREE.EdgesGeometry(geom, thresholdDeg),
            edgeMaterial
          )
        )
      }
      const tyre = new THREE.CylinderGeometry(
        WHEEL_RADIUS,
        WHEEL_RADIUS,
        WHEEL_THICKNESS,
        WHEEL_SEGMENTS
      )
      wheelPart(tyre, 10)
      const rim = new THREE.CylinderGeometry(
        RIM_RADIUS,
        RIM_RADIUS,
        WHEEL_THICKNESS + 0.5,
        14
      )
      wheelPart(rim, 10)
      const faceY = out * (WHEEL_THICKNESS / 2 + 0.5)
      for (let k = 0; k < SPOKE_COUNT; k++) {
        const spoke = new THREE.BoxGeometry(5.4, 1.0, 1.7)
        spoke.translate(4.4, 0, 0)
        spoke.rotateY((k * 2 * Math.PI) / SPOKE_COUNT + (out > 0 ? 0.3 : 0))
        spoke.translate(0, faceY, 0)
        wheelPart(spoke, 25)
      }
      const hub = new THREE.CylinderGeometry(2, 2, 1.4, 12)
      hub.translate(0, faceY, 0)
      wheelPart(hub, 25)
      wheels.push(wheel)
    }
  }

  // Door mirrors: a shell on a stalk long enough to reach in through the
  // tumblehome and meet the glass at the base of the A-pillar. The front view
  // makes these prominent, so they are generously sized.
  for (const s of [1, -1]) {
    const shell = new THREE.BoxGeometry(3.6, 2.6, 2.6)
    shell.translate(10.5, s * 25.4, 24.8)
    detail(shell, 25)
    const stalk = new THREE.BoxGeometry(1.4, 7, 0.9)
    stalk.translate(11, s * 21.8, 23.8)
    detail(stalk, 25)
  }

  // Shark-fin antenna on the rear roof, leaning back with the roofline.
  const finShape = new THREE.Shape()
  finShape.moveTo(-36.8, 0)
  finShape.lineTo(-32.8, 0)
  finShape.lineTo(-36.4, 2.6)
  finShape.closePath()
  const fin = extrudeProfile(finShape, 1.4)
  fin.translate(0, 0, hullParams(-34.5).zTop + 0.4)
  detail(fin, 25)

  // Roof spoiler: a lip over the tailgate glass, carrying the roofline a touch
  // past the tail the way the reference's rear roof edge reads.
  const spoiler = new THREE.BoxGeometry(4.5, 21, 1.4)
  spoiler.translate(TAIL_X - 0.4, 0, hullParams(TAIL_X).zTop + 0.5)
  detail(spoiler, 25)

  // Front fascia, nose-in view: mesh grille, full-width honeycomb intake,
  // headlight + fog-light outlines, and a bumper skid plate — line-only panels
  // floating just proud of the flat nose cap.
  lineGeoms.push(panelGrid(NOSE_X + 0.2, -10.5, 10.5, 14.5, 19.5, 13, 3))
  lineGeoms.push(panelGrid(NOSE_X + 0.2, -13.8, 13.8, 9.8, 13, 17, 2))
  for (const s of [1, -1]) {
    lineGeoms.push(panelGrid(NOSE_X + 0.15, s * 10.8, s * 13.8, 19.8, 21.8, 1, 1))
    lineGeoms.push(panelGrid(NOSE_X + 0.15, s * 13.9, s * 15.4, 10.4, 12.4, 1, 1))
  }
  lineGeoms.push(panelGrid(NOSE_X + 0.2, -7.8, 7.8, 8.2, 9.4, 2, 1))

  // Tail (no reference view, so invented in the same idiom): wide two-segment
  // taillight bars, licence plate, exhaust trims and a skid plate.
  for (const s of [1, -1]) {
    lineGeoms.push(panelGrid(TAIL_X - 0.15, s * 6, s * 13.5, 22.3, 24, 2, 1))
    lineGeoms.push(panelGrid(TAIL_X - 0.15, s * 9.5, s * 12.5, 9.3, 10.8, 1, 1))
  }
  lineGeoms.push(panelGrid(TAIL_X - 0.15, -5.5, 5.5, 14.5, 18.5, 1, 1))
  lineGeoms.push(panelGrid(TAIL_X - 0.15, -8, 8, 7.7, 9, 2, 1))

  // Feature lines on the hull skin, sampled from the same zTop the loft uses so
  // they hug the surface: a sunroof outline, hood cutlines converging toward
  // the grille, and a pair of wipers at the cowl.
  const roofAt = (x: number) => hullParams(x).zTop
  const sunroof: number[][] = []
  for (let x = 2; x >= -30; x -= 4) sunroof.push([x, 7.2, roofAt(x) + 0.55])
  for (let x = -30; x <= 2; x += 4) sunroof.push([x, -7.2, roofAt(x) + 0.55])
  lineGeoms.push(polyline(sunroof, true))
  for (const s of [1, -1]) {
    const hoodLine: number[][] = []
    for (let i = 0; i <= 6; i++) {
      const x = 17 + ((46 - 17) * i) / 6
      hoodLine.push([x, s * (12 - 4 * (i / 6)), roofAt(x) + 0.35])
    }
    lineGeoms.push(polyline(hoodLine))
    lineGeoms.push(
      polyline([
        [16, s * 1.5, roofAt(16) + 0.5],
        [12, s * 6.5, roofAt(12) + 0.5],
        [10.5, s * 9.2, roofAt(10.5) + 0.5],
      ])
    )
  }

  const box = new THREE.Box3()
  for (const g of faceGeoms) {
    g.computeBoundingBox()
    if (g.boundingBox) box.union(g.boundingBox)
  }
  // The wheels hang below the hull's floor, so the box must include them —
  // setFromObject folds each wheel group's hub position into its parts' bounds.
  for (const w of wheels) box.union(new THREE.Box3().setFromObject(w))
  const center = box.getCenter(new THREE.Vector3())
  for (const g of faceGeoms) g.translate(-center.x, -center.y, -center.z)
  for (const g of lineGeoms) g.translate(-center.x, -center.y, -center.z)
  // The wheels recentre by moving their pivots, keeping spin about the axle.
  for (const w of wheels) w.position.sub(center)

  const group = new THREE.Group()
  for (const g of faceGeoms) group.add(new THREE.Mesh(g, faceMaterial))
  for (const g of lineGeoms) group.add(new THREE.LineSegments(g, edgeMaterial))
  for (const w of wheels) group.add(w)

  // Half the bounding-box diagonal, plus a little headroom. Framing against this
  // sphere (rather than the current pose's silhouette) keeps the car the same
  // size as it turns and guarantees it never crops at any orientation.
  const radius = 0.5 * box.getSize(new THREE.Vector3()).length() * 1.08
  return { group, radius, wheels }
}

/**
 * Live 3D orientation of the device, driven by the IMU euler stream. Renders a
 * wireframe SUV — a friendlier stand-in for the bare board — at the device's
 * orientation, in a scene that follows the app's light/dark theme.
 *
 * Frames: the agent publishes Tait-Bryan ZYX euler angles in degrees (roll about
 * body X, pitch about Y, yaw about Z) in a Z-up body frame, while three.js is
 * Y-up. The car mesh therefore carries the raw device rotation, and a parent
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
  // Ground speed in m/s for the wheel spin, fed the same way as the quaternion:
  // the render loop eases toward it so the ~1 Hz samples don't step.
  const targetSpeedRef = useRef(0)
  // Camera direction + a handle to re-run the fit, so a settings change (or the
  // device row arriving after mount) moves the camera without rebuilding the
  // scene — same reason the orientation flows through a ref above.
  const viewDirRef = useRef(viewDirFrom(view ?? DEFAULT_VIEW))
  const refitRef = useRef<(() => void) | null>(null)
  // Held so a theme change can recolour the existing scene in place. Rebuilding
  // it instead would drop the WebGL context and reset the car's smoothed
  // orientation, making it lurch back to level on every toggle.
  const sceneRef = useRef<THREE.Scene | null>(null)
  const faceMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null)
  const edgeMaterialRef = useRef<THREE.LineBasicMaterial | null>(null)
  const isDark = useIsDark()

  const roll = readAngle(latest, "imu.euler_roll")
  const pitch = readAngle(latest, "imu.euler_pitch")
  const yaw = readAngle(latest, "imu.euler_yaw")
  const hasFix = eulerMetrics.some((m) => latest[m] !== undefined)

  // GPS ground speed, published in km/h (the collector converts RMC knots).
  // Absent on devices without GPS — the wheels just stay still.
  const speedValue = latest["gps.speed"]?.value
  const speedKmh = typeof speedValue === "number" ? Math.max(0, speedValue) : 0

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
    targetSpeedRef.current = speedKmh / 3.6
  }, [speedKmh])

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

    // Opaque faces so the car reads as a solid body: a bare wireframe is an
    // ambiguous tangle and you cannot tell which way it is turning. The polygon
    // offset pushes the faces back a hair so the edges never z-fight.
    const faceMaterial = new THREE.MeshBasicMaterial({
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      // The lofted hull is hand-wound; double-sided faces make occlusion immune
      // to any quad coming out back-to-front.
      side: THREE.DoubleSide,
    })
    const edgeMaterial = new THREE.LineBasicMaterial()
    faceMaterialRef.current = faceMaterial
    edgeMaterialRef.current = edgeMaterial

    const { group: car, radius, wheels } = buildCar(faceMaterial, edgeMaterial)

    // The car spins about its own centroid; this outer group carries the device
    // orientation quaternion, which the render loop slerps toward each frame.
    const body = new THREE.Group()
    body.add(car)
    frame.add(body)

    // Frame the car for the current aspect: fit against whichever of the
    // vertical / horizontal fov is tighter, so it never crops in a narrow panel.
    const fit = (aspect: number) => {
      const vFov = THREE.MathUtils.degToRad(FOV_DEG)
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
      const distance = Math.max(
        radius / Math.sin(vFov / 2),
        radius / Math.sin(hFov / 2)
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

    // The panel resizes with the column (and the app sidebar collapsing), which
    // fires no window resize event.
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    let frameId = 0
    let prev = performance.now()
    let wheelSpeed = 0 // smoothed ground speed, m/s
    const tick = (now: number) => {
      const dt = Math.min((now - prev) / 1000, 0.1) // clamp after a hidden tab
      prev = now
      const ease = 1 - Math.exp(-SMOOTHING_LAMBDA * dt)
      body.quaternion.slerp(targetQuatRef.current, ease)
      // Roll the wheels at the ground speed: ω = v / r about body +Y, which by
      // the right-hand rule carries the tyre's top toward the nose (+X).
      wheelSpeed += (targetSpeedRef.current - wheelSpeed) * ease
      const spin = (wheelSpeed / WHEEL_RADIUS_M) * dt
      for (const wheel of wheels) wheel.rotation.y += spin
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      refitRef.current = null
      car.traverse((obj) => {
        const geom = (obj as Partial<THREE.Mesh>).geometry
        if (geom) geom.dispose()
      })
      faceMaterial.dispose()
      edgeMaterial.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      sceneRef.current = null
      faceMaterialRef.current = null
      edgeMaterialRef.current = null
    }
  }, [])

  // Re-aim the camera when the per-device view setting changes (or first
  // arrives — the device row usually lands after the scene has mounted).
  useEffect(() => {
    viewDirRef.current = viewDirFrom(view ?? DEFAULT_VIEW)
    refitRef.current?.()
  }, [view])

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
    // flex-1 so the car absorbs whatever height the IMU numbers above it and the
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

      {/* The euler angles driving the car, so the view is readable as numbers
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
