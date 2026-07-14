import type { Edge } from "@xyflow/react"
import type { WfNode } from "./workflow-nodes"

// Spacing between successive depth rows (y) and parallel lanes (x). Matches the
// hand-placed seed layouts of the original demo graphs so auto-laid graphs blend in.
const ROW_GAP = 130
const LANE_GAP = 240
// Fallback node width used only when react-flow hasn't measured a node yet
// (roughly a mid-width card); real widths come from `node.measured`.
const DEFAULT_WIDTH = 180

// Arrange the graph as a top-to-bottom layered (Sugiyama-style) DAG:
//   • rank = longest path from a source, so every edge points downward;
//   • within a rank, order nodes by the barycenter of their neighbours to
//     reduce edge crossings;
//   • narrower ranks are centred under the widest one.
// Only positions are rewritten — node data and identity are preserved. Cycles
// (which a valid workflow shouldn't contain) degrade gracefully: any node the
// topological pass never reaches falls back to rank 0 instead of hanging.
export function layoutVertical(nodes: WfNode[], edges: Edge[]): WfNode[] {
  if (nodes.length === 0) return nodes

  const ids = new Set(nodes.map((n) => n.id))
  const children = new Map<string, string[]>()
  const parents = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const n of nodes) {
    children.set(n.id, [])
    parents.set(n.id, [])
    indegree.set(n.id, 0)
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue
    children.get(e.source)!.push(e.target)
    parents.get(e.target)!.push(e.source)
    indegree.set(e.target, indegree.get(e.target)! + 1)
  }

  // Longest-path layering via Kahn's topological order.
  const rank = new Map<string, number>()
  const remaining = new Map(indegree)
  const queue: string[] = []
  for (const n of nodes) {
    if (remaining.get(n.id) === 0) {
      rank.set(n.id, 0)
      queue.push(n.id)
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head]
    for (const v of children.get(u)!) {
      rank.set(v, Math.max(rank.get(v) ?? 0, (rank.get(u) ?? 0) + 1))
      remaining.set(v, remaining.get(v)! - 1)
      if (remaining.get(v) === 0) queue.push(v)
    }
  }
  for (const n of nodes) if (!rank.has(n.id)) rank.set(n.id, 0)

  // Bucket nodes by rank, seeded in their current insertion order.
  const maxRank = Math.max(...nodes.map((n) => rank.get(n.id)!))
  const layers: string[][] = Array.from({ length: maxRank + 1 }, () => [])
  for (const n of nodes) layers[rank.get(n.id)!].push(n.id)

  // Crossing reduction: alternate down/up barycenter sweeps. A node with no
  // neighbours in the reference direction keeps its current index.
  const orderIndex = new Map<string, number>()
  const reindex = () => {
    for (const layer of layers) layer.forEach((id, i) => orderIndex.set(id, i))
  }
  reindex()
  const barycenter = (id: string, neighbours: Map<string, string[]>) => {
    const ns = neighbours.get(id)!.filter((m) => orderIndex.has(m))
    if (ns.length === 0) return orderIndex.get(id)!
    return ns.reduce((sum, m) => sum + orderIndex.get(m)!, 0) / ns.length
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let r = 1; r <= maxRank; r++) {
      layers[r].sort((a, b) => barycenter(a, parents) - barycenter(b, parents))
      reindex()
    }
    for (let r = maxRank - 1; r >= 0; r--) {
      layers[r].sort((a, b) => barycenter(a, children) - barycenter(b, children))
      reindex()
    }
  }

  // Assign coordinates. Lanes are spaced by their *centres* (LANE_GAP apart),
  // and every rank is centred under the widest one. Handles sit at a node's
  // horizontal centre, so we place each node by centring it on its lane axis
  // (x = laneCentre − width/2) rather than by its left edge — otherwise cards of
  // different widths leave the connectors zig-zagging. Width comes from
  // react-flow's measurement, falling back to a nominal width if unmeasured.
  const widthOf = (node: WfNode) =>
    node.measured?.width ?? node.width ?? DEFAULT_WIDTH
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const laneSpan = Math.max(...layers.map((l) => (l.length - 1) * LANE_GAP))
  const positions = new Map<string, { x: number; y: number }>()
  layers.forEach((layer, r) => {
    const firstCentre = (laneSpan - (layer.length - 1) * LANE_GAP) / 2
    layer.forEach((id, i) => {
      const laneCentre = firstCentre + i * LANE_GAP
      positions.set(id, {
        x: laneCentre - widthOf(byId.get(id)!) / 2,
        y: r * ROW_GAP,
      })
    })
  })

  return nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position }))
}
