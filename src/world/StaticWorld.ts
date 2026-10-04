import { circleVsAabb, obbVsAabb, type Obb2, type Vec2Like } from './geom2d';

/**
 * Registry of static axis-aligned boxes (buildings, walls, counters, poles...).
 * Indexed in a uniform XZ grid so movement, line-of-sight and ray queries only
 * touch nearby boxes. Never scans the whole scene per frame.
 */
export interface StaticBox {
  id: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  /** Blocks police / civilian line of sight. */
  blocksSight: boolean;
  /** Blocks on-foot movement (player, pedestrians). */
  blocksWalk: boolean;
  /** Blocks AI car movement. */
  blocksCars: boolean;
  tag: string;
}

export interface RayHit {
  t: number;
  box: StaticBox;
  nx: number;
  ny: number;
  nz: number;
}

export interface StaticBoxOptions {
  blocksSight?: boolean;
  blocksWalk?: boolean;
  blocksCars?: boolean;
  tag?: string;
}

const WALK_MIN_Y = 0.35; // anything lower than this is stepped over
const WALK_MAX_Y = 1.9; // anything starting above this is walked under

export class StaticWorld {
  readonly boxes: StaticBox[] = [];
  private readonly cells = new Map<number, number[]>();
  private stamp = 1;
  private readonly stamps: number[] = [];
  private readonly tmp: Vec2Like = { x: 0, z: 0 };

  constructor(
    readonly cellSize = 8,
    readonly halfExtent = 160,
  ) {}

  add(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, opts: StaticBoxOptions = {}): StaticBox {
    const box: StaticBox = {
      id: this.boxes.length,
      minX: Math.min(minX, maxX),
      maxX: Math.max(minX, maxX),
      minY: Math.min(minY, maxY),
      maxY: Math.max(minY, maxY),
      minZ: Math.min(minZ, maxZ),
      maxZ: Math.max(minZ, maxZ),
      blocksSight: opts.blocksSight ?? box3Tall(minY, maxY),
      blocksWalk: opts.blocksWalk ?? true,
      blocksCars: opts.blocksCars ?? true,
      tag: opts.tag ?? '',
    };
    this.boxes.push(box);
    this.stamps.push(0);
    const [c0x, c0z] = this.cellOf(box.minX, box.minZ);
    const [c1x, c1z] = this.cellOf(box.maxX, box.maxZ);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const key = this.key(cx, cz);
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push(box.id);
      }
    }
    return box;
  }

  /** Adds a box from centre + size (convenient for builders). */
  addCentered(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, opts?: StaticBoxOptions): StaticBox {
    return this.add(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, opts);
  }

  private cellOf(x: number, z: number): [number, number] {
    return [Math.floor((x + this.halfExtent) / this.cellSize), Math.floor((z + this.halfExtent) / this.cellSize)];
  }

  private key(cx: number, cz: number): number {
    return cx * 4096 + cz;
  }

  /** Collects boxes overlapping a 2D rectangle (deduplicated). */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: StaticBox[]): StaticBox[] {
    out.length = 0;
    const s = ++this.stamp;
    const [c0x, c0z] = this.cellOf(minX, minZ);
    const [c1x, c1z] = this.cellOf(maxX, maxZ);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (const id of list) {
          if (this.stamps[id] === s) continue;
          this.stamps[id] = s;
          const b = this.boxes[id];
          if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
          out.push(b);
        }
      }
    }
    return out;
  }

  private readonly queryBuf: StaticBox[] = [];

  /**
   * Pushes a walking circle out of walk-blocking boxes. Modifies pos in place.
   * Returns true when any collision was resolved.
   */
  resolveCircle(pos: Vec2Like, radius: number, feetY = 0, filter?: (b: StaticBox) => boolean): boolean {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      const list = this.query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, this.queryBuf);
      let moved = false;
      for (const b of list) {
        if (!b.blocksWalk) continue;
        if (b.maxY < feetY + WALK_MIN_Y || b.minY > feetY + WALK_MAX_Y) continue;
        if (filter && !filter(b)) continue;
        if (circleVsAabb(pos.x, pos.z, radius, b.minX, b.minZ, b.maxX, b.maxZ, this.tmp)) {
          pos.x += this.tmp.x;
          pos.z += this.tmp.z;
          moved = true;
          hit = true;
        }
      }
      if (!moved) break;
    }
    return hit;
  }

  /** True if a walking circle at (x,z) would overlap any walk-blocking box. */
  isCircleBlocked(x: number, z: number, radius: number, feetY = 0): boolean {
    const list = this.query(x - radius, z - radius, x + radius, z + radius, this.queryBuf);
    for (const b of list) {
      if (!b.blocksWalk) continue;
      if (b.maxY < feetY + WALK_MIN_Y || b.minY > feetY + WALK_MAX_Y) continue;
      if (circleVsAabb(x, z, radius, b.minX, b.minZ, b.maxX, b.maxZ, this.tmp)) return true;
    }
    return false;
  }

  /** Pushes an oriented car footprint out of car-blocking boxes (AI cars are kinematic). */
  resolveObb(obb: Obb2, out: Vec2Like): boolean {
    out.x = 0;
    out.z = 0;
    const r = Math.hypot(obb.halfW, obb.halfL);
    const list = this.query(obb.cx - r, obb.cz - r, obb.cx + r, obb.cz + r, this.queryBuf);
    let hit = false;
    for (const b of list) {
      if (!b.blocksCars || b.maxY < 0.3 || b.minY > 1.5) continue;
      if (obbVsAabb(obb, b.minX, b.minZ, b.maxX, b.maxZ, this.tmp)) {
        obb.cx += this.tmp.x;
        obb.cz += this.tmp.z;
        out.x += this.tmp.x;
        out.z += this.tmp.z;
        hit = true;
      }
    }
    return hit;
  }

  isObbBlocked(obb: Obb2): boolean {
    const r = Math.hypot(obb.halfW, obb.halfL);
    const list = this.query(obb.cx - r, obb.cz - r, obb.cx + r, obb.cz + r, this.queryBuf);
    for (const b of list) {
      if (!b.blocksCars || b.maxY < 0.3 || b.minY > 1.5) continue;
      if (obbVsAabb(obb, b.minX, b.minZ, b.maxX, b.maxZ, this.tmp)) return true;
    }
    return false;
  }

  /**
   * 3D ray cast against boxes (slab method) with grid traversal.
   * `filter` decides which boxes count (e.g. only sight blockers).
   */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    filter?: (b: StaticBox) => boolean,
  ): RayHit | null {
    const s = ++this.stamp;
    let best: RayHit | null = null;
    let bestT = maxDist;
    // Amanatides-Woo traversal over the XZ grid.
    const cs = this.cellSize;
    let [cx, cz] = this.cellOf(ox, oz);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const nextBoundX = (cx + (stepX > 0 ? 1 : 0)) * cs - this.halfExtent;
    const nextBoundZ = (cz + (stepZ > 0 ? 1 : 0)) * cs - this.halfExtent;
    let tMaxX = Math.abs(dx) < 1e-9 ? Infinity : (nextBoundX - ox) / dx;
    let tMaxZ = Math.abs(dz) < 1e-9 ? Infinity : (nextBoundZ - oz) / dz;
    const tDeltaX = Math.abs(dx) < 1e-9 ? Infinity : cs / Math.abs(dx);
    const tDeltaZ = Math.abs(dz) < 1e-9 ? Infinity : cs / Math.abs(dz);
    let tCell = 0;
    for (let guard = 0; guard < 256; guard++) {
      const list = this.cells.get(this.key(cx, cz));
      if (list) {
        for (const id of list) {
          if (this.stamps[id] === s) continue;
          this.stamps[id] = s;
          const b = this.boxes[id];
          if (filter && !filter(b)) continue;
          const h = rayAabb(ox, oy, oz, dx, dy, dz, b);
          if (h && h.t < bestT) {
            bestT = h.t;
            best = { t: h.t, box: b, nx: h.nx, ny: h.ny, nz: h.nz };
          }
        }
      }
      // No later cell can contain a closer hit than one before this cell's exit.
      const tExit = Math.min(tMaxX, tMaxZ);
      if (best && best.t <= tExit) break;
      if (tMaxX < tMaxZ) {
        tCell = tMaxX;
        tMaxX += tDeltaX;
        cx += stepX;
      } else {
        tCell = tMaxZ;
        tMaxZ += tDeltaZ;
        cz += stepZ;
      }
      if (tCell > bestT || tCell > maxDist) break;
    }
    return best;
  }

  /** True when a sight-blocking box lies between two points. */
  isSightBlocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return false;
    const hit = this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05, sightFilter);
    return hit !== null;
  }

  /** True if the point is inside any box (used to validate teleports / item drops). */
  isPointInside(x: number, y: number, z: number, margin = 0): boolean {
    const list = this.query(x - margin, z - margin, x + margin, z + margin, this.queryBuf);
    for (const b of list) {
      if (x >= b.minX - margin && x <= b.maxX + margin && z >= b.minZ - margin && z <= b.maxZ + margin && y >= b.minY && y <= b.maxY) {
        return true;
      }
    }
    return false;
  }
}

function box3Tall(minY: number, maxY: number): boolean {
  return maxY - minY > 1.4 && minY < 1.2;
}

const sightFilter = (b: StaticBox): boolean => b.blocksSight;

function rayAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  b: StaticBox,
): { t: number; nx: number; ny: number; nz: number } | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const axes: [number, number, number, number][] = [
    [ox, dx, b.minX, b.maxX],
    [oy, dy, b.minY, b.maxY],
    [oz, dz, b.minZ, b.maxZ],
  ];
  for (let i = 0; i < 3; i++) {
    const [o, d, lo, hi] = axes[i];
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    let sign = -1;
    if (t1 > t2) {
      const tt = t1;
      t1 = t2;
      t2 = tt;
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = i === 0 ? sign : 0;
      ny = i === 1 ? sign : 0;
      nz = i === 2 ? sign : 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  if (tmin < 0) return { t: 0, nx: 0, ny: 0, nz: 0 }; // origin inside box
  return { t: tmin, nx, ny, nz };
}
