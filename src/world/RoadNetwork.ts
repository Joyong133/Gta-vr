import { CITY } from './CityLayout';

/**
 * Road graph for the district: 3 x 3 grid of road lines -> 9 intersections,
 * 12 road segments, directed lanes (right-hand traffic) and turn connectors.
 * Used by traffic (lane following), police (navigation), vehicle recovery and missions.
 */

export interface Point2 {
  x: number;
  z: number;
}

export type Axis = 'ns' | 'ew';

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  neighbors: number[];
  hasLight: boolean;
}

export interface LanePath {
  id: number;
  kind: 'road' | 'turn';
  points: Point2[];
  cum: number[];
  length: number;
  /** Node this lane drives toward (for road lanes) / node it passes through (turns). */
  node: number;
  /** For road lanes: node it starts from. */
  fromNode: number;
  axis: Axis;
  next: LanePath[];
  /** Road lanes only: the speed limit along this lane. */
  speedLimit: number;
}

export type LightState = 'green' | 'yellow' | 'red';

const GREEN = 10;
const YELLOW = 2.5;
const ALL_RED = 1.5;
const CYCLE = (GREEN + YELLOW + ALL_RED) * 2;

export class RoadNetwork {
  readonly nodes: RoadNode[] = [];
  readonly lanes: LanePath[] = [];
  readonly roadLanes: LanePath[] = [];
  private nodeIndex = new Map<string, number>();
  readonly laneOffset = CITY.laneOffset;
  readonly junctionHalf = CITY.roadHalfWidth + 1;

  constructor() {
    const lines = CITY.roadLines;
    for (const z of lines) {
      for (const x of lines) {
        const id = this.nodes.length;
        this.nodes.push({ id, x, z, neighbors: [], hasLight: false });
        this.nodeIndex.set(`${x},${z}`, id);
      }
    }
    // Connect adjacent nodes along each road line.
    for (let j = 0; j < lines.length; j++) {
      for (let i = 0; i < lines.length; i++) {
        const a = this.nodeAt(lines[i], lines[j]);
        if (i + 1 < lines.length) this.link(a, this.nodeAt(lines[i + 1], lines[j]));
        if (j + 1 < lines.length) this.link(a, this.nodeAt(lines[i], lines[j + 1]));
      }
    }
    for (const n of this.nodes) n.hasLight = n.neighbors.length >= 3;
    this.buildLanes();
  }

  nodeAt(x: number, z: number): number {
    const id = this.nodeIndex.get(`${x},${z}`);
    if (id === undefined) throw new Error(`no road node at ${x},${z}`);
    return id;
  }

  private link(a: number, b: number): void {
    this.nodes[a].neighbors.push(b);
    this.nodes[b].neighbors.push(a);
  }

  private buildLanes(): void {
    const off = this.laneOffset;
    const jh = this.junctionHalf;
    // Road lanes: one per direction per segment.
    const incoming = new Map<number, LanePath[]>();
    const outgoing = new Map<number, LanePath[]>();
    for (const a of this.nodes) {
      for (const bi of a.neighbors) {
        const b = this.nodes[bi];
        const dx = Math.sign(b.x - a.x);
        const dz = Math.sign(b.z - a.z);
        // Right of travel direction (forward d, up y): right = d x up = (-dz, 0, dx)
        const rx = -dz;
        const rz = dx;
        const start = { x: a.x + dx * jh + rx * off, z: a.z + dz * jh + rz * off };
        const end = { x: b.x - dx * jh + rx * off, z: b.z - dz * jh + rz * off };
        const lane = this.makeLane('road', [start, end], b.id, a.id, dx !== 0 ? 'ew' : 'ns', CITY.speedLimit);
        this.roadLanes.push(lane);
        if (!incoming.has(b.id)) incoming.set(b.id, []);
        incoming.get(b.id)!.push(lane);
        if (!outgoing.has(a.id)) outgoing.set(a.id, []);
        outgoing.get(a.id)!.push(lane);
      }
    }
    // Turn connectors through each node.
    for (const n of this.nodes) {
      for (const inLane of incoming.get(n.id) ?? []) {
        for (const outLane of outgoing.get(n.id) ?? []) {
          const outTarget = outLane.node;
          if (outTarget === inLane.fromNode) continue; // no U-turns
          const p0 = inLane.points[inLane.points.length - 1];
          const p2 = outLane.points[0];
          const inDir = dirOf(inLane);
          const outDir = dirOf(outLane);
          const straight = Math.abs(inDir.x * outDir.x + inDir.z * outDir.z) > 0.9;
          let pts: Point2[];
          if (straight) {
            pts = [p0, p2];
          } else {
            // Control point: intersection of the incoming line and outgoing line.
            const c = lineIntersect(p0, inDir, p2, outDir) ?? { x: n.x, z: n.z };
            pts = [];
            for (let i = 0; i <= 8; i++) {
              const t = i / 8;
              const u = 1 - t;
              pts.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, z: u * u * p0.z + 2 * u * t * c.z + t * t * p2.z });
            }
          }
          const turn = this.makeLane('turn', pts, n.id, n.id, inLane.axis, straight ? CITY.speedLimit : 6.5);
          turn.next.push(outLane);
          inLane.next.push(turn);
        }
      }
    }
  }

  private makeLane(kind: 'road' | 'turn', points: Point2[], node: number, fromNode: number, axis: Axis, speedLimit: number): LanePath {
    const cum = [0];
    for (let i = 1; i < points.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
    }
    const lane: LanePath = {
      id: this.lanes.length,
      kind,
      points,
      cum,
      length: cum[cum.length - 1],
      node,
      fromNode,
      axis,
      next: [],
      speedLimit,
    };
    this.lanes.push(lane);
    return lane;
  }

  /** Samples position + tangent at distance s along a lane. */
  sample(lane: LanePath, s: number, outPos: Point2, outDir: Point2): void {
    const pts = lane.points;
    const cum = lane.cum;
    if (s <= 0) {
      outPos.x = pts[0].x;
      outPos.z = pts[0].z;
      segDir(pts[0], pts[1], outDir);
      return;
    }
    if (s >= lane.length) {
      const n = pts.length;
      outPos.x = pts[n - 1].x;
      outPos.z = pts[n - 1].z;
      segDir(pts[n - 2], pts[n - 1], outDir);
      return;
    }
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1];
    const t = seg > 0 ? (s - cum[i - 1]) / seg : 0;
    outPos.x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t;
    outPos.z = pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t;
    segDir(pts[i - 1], pts[i], outDir);
  }

  /** Light state for traffic arriving on `axis` at node `nodeId`, at time t (seconds). */
  lightState(nodeId: number, axis: Axis, t: number): LightState {
    const n = this.nodes[nodeId];
    if (!n.hasLight) return 'green';
    // Offset each junction's cycle a little so the grid does not switch in unison.
    const phase = (t + nodeId * 3.7) % CYCLE;
    const nsPhase = phase < GREEN ? 'green' : phase < GREEN + YELLOW ? 'yellow' : 'red';
    const ewStart = GREEN + YELLOW + ALL_RED;
    const ewPhase = phase >= ewStart && phase < ewStart + GREEN ? 'green' : phase >= ewStart + GREEN && phase < ewStart + GREEN + YELLOW ? 'yellow' : 'red';
    return axis === 'ns' ? nsPhase : ewPhase;
  }

  /** Closest road lane point to (x,z). */
  nearestLanePoint(x: number, z: number): { lane: LanePath; s: number; pos: Point2; dir: Point2; dist: number } {
    let best = { lane: this.roadLanes[0], s: 0, pos: { x: 0, z: 0 }, dir: { x: 1, z: 0 }, dist: Infinity };
    const p = { x: 0, z: 0 };
    for (const lane of this.roadLanes) {
      const a = lane.points[0];
      const b = lane.points[lane.points.length - 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2)) : 0;
      p.x = a.x + abx * t;
      p.z = a.z + abz * t;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < best.dist) {
        const len = Math.sqrt(len2);
        best = { lane, s: t * lane.length, pos: { x: p.x, z: p.z }, dir: { x: abx / len, z: abz / len }, dist: d };
      }
    }
    return best;
  }

  nearestNode(x: number, z: number): RoadNode {
    let best = this.nodes[0];
    let bd = Infinity;
    for (const n of this.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  /** Dijkstra over intersections. Returns node ids from `from` to `to` inclusive. */
  findPath(from: number, to: number): number[] {
    const dist = new Array(this.nodes.length).fill(Infinity);
    const prev = new Array<number>(this.nodes.length).fill(-1);
    const done = new Array<boolean>(this.nodes.length).fill(false);
    dist[from] = 0;
    for (;;) {
      let u = -1;
      let ud = Infinity;
      for (let i = 0; i < dist.length; i++) {
        if (!done[i] && dist[i] < ud) {
          ud = dist[i];
          u = i;
        }
      }
      if (u < 0 || u === to) break;
      done[u] = true;
      for (const v of this.nodes[u].neighbors) {
        const w = Math.hypot(this.nodes[u].x - this.nodes[v].x, this.nodes[u].z - this.nodes[v].z);
        if (dist[u] + w < dist[v]) {
          dist[v] = dist[u] + w;
          prev[v] = u;
        }
      }
    }
    if (from !== to && prev[to] < 0) return [from];
    const path: number[] = [];
    for (let v = to; v !== -1; v = prev[v]) {
      path.unshift(v);
      if (v === from) break;
    }
    return path;
  }

  /** True when (x,z) is on asphalt (road surface incl. junctions). */
  isOnRoad(x: number, z: number): boolean {
    const hw = CITY.roadHalfWidth;
    const lines = CITY.roadLines;
    const min = lines[0] - hw;
    const max = lines[lines.length - 1] + hw;
    if (x < min || x > max || z < min || z > max) return false;
    for (const l of lines) {
      if (Math.abs(x - l) <= hw || Math.abs(z - l) <= hw) return true;
    }
    return false;
  }
}

function dirOf(lane: LanePath): Point2 {
  const a = lane.points[0];
  const b = lane.points[lane.points.length - 1];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
}

function segDir(a: Point2, b: Point2, out: Point2): void {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  out.x = (b.x - a.x) / len;
  out.z = (b.z - a.z) / len;
}

function lineIntersect(p: Point2, d: Point2, q: Point2, e: Point2): Point2 | null {
  const den = d.x * e.z - d.z * e.x;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((q.x - p.x) * e.z - (q.z - p.z) * e.x) / den;
  return { x: p.x + d.x * t, z: p.z + d.z * t };
}
