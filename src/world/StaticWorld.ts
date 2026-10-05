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
/** isCorridorBlocked queries the grid in pieces this long, so a long diagonal never scans a huge rectangle. */
const CORRIDOR_PIECE = 16;

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
    const c0x = this.cellIndex(box.minX);
    const c0z = this.cellIndex(box.minZ);
    const c1x = this.cellIndex(box.maxX);
    const c1z = this.cellIndex(box.maxZ);
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

  /** Grid cell index of a world coordinate (same for X and Z). */
  private cellIndex(v: number): number {
    return Math.floor((v + this.halfExtent) / this.cellSize);
  }

  private key(cx: number, cz: number): number {
    return cx * 4096 + cz;
  }

  /** Collects boxes overlapping a 2D rectangle (deduplicated). */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: StaticBox[]): StaticBox[] {
    out.length = 0;
    const s = ++this.stamp;
    const c0x = this.cellIndex(minX);
    const c0z = this.cellIndex(minZ);
    const c1x = this.cellIndex(maxX);
    const c1z = this.cellIndex(maxZ);
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
    let cx = this.cellIndex(ox);
    let cz = this.cellIndex(oz);
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

  /**
   * True when a box accepted by `filter` comes within `halfWidth` of the XZ segment (x0,z0)-(x1,z1):
   * a swept car-width corridor. Unlike a few parallel rays it cannot slip past a thin pole.
   * Box corners count as square (slightly conservative).
   */
  isCorridorBlocked(x0: number, z0: number, x1: number, z1: number, halfWidth: number, filter?: (b: StaticBox) => boolean): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const pieces = Math.max(1, Math.ceil(Math.hypot(dx, dz) / CORRIDOR_PIECE));
    for (let i = 0; i < pieces; i++) {
      const ax = x0 + (dx * i) / pieces;
      const az = z0 + (dz * i) / pieces;
      const bx = x0 + (dx * (i + 1)) / pieces;
      const bz = z0 + (dz * (i + 1)) / pieces;
      const list = this.query(
        Math.min(ax, bx) - halfWidth,
        Math.min(az, bz) - halfWidth,
        Math.max(ax, bx) + halfWidth,
        Math.max(az, bz) + halfWidth,
        this.queryBuf,
      );
      for (const b of list) {
        if (filter && !filter(b)) continue;
        if (segmentHitsRect(x0, z0, dx, dz, b.minX - halfWidth, b.minZ - halfWidth, b.maxX + halfWidth, b.maxZ + halfWidth)) return true;
      }
    }
    return false;
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

/** Does the segment p + t*d, t in [0,1], touch the XZ rectangle? (2D slab test) */
function segmentHitsRect(px: number, pz: number, dx: number, dz: number, minX: number, minZ: number, maxX: number, maxZ: number): boolean {
  let t0 = 0;
  let t1 = 1;
  if (Math.abs(dx) < 1e-9) {
    if (px < minX || px > maxX) return false;
  } else {
    let a = (minX - px) / dx;
    let b = (maxX - px) / dx;
    if (a > b) {
      const t = a;
      a = b;
      b = t;
    }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (pz < minZ || pz > maxZ) return false;
  } else {
    let a = (minZ - pz) / dz;
    let b = (maxZ - pz) / dz;
    if (a > b) {
      const t = a;
      a = b;
      b = t;
    }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return false;
  }
  return true;
}

/** Scratch slab inputs for rayAabb (x, y, z), so the hot ray path allocates nothing per box. */
const _ro = new Float64Array(3);
const _rd = new Float64Array(3);
const _rlo = new Float64Array(3);
const _rhi = new Float64Array(3);
/** Reused rayAabb result: only valid until the next call (raycast copies what it keeps). */
const _rayRes = { t: 0, nx: 0, ny: 0, nz: 0 };

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
  _ro[0] = ox;
  _ro[1] = oy;
  _ro[2] = oz;
  _rd[0] = dx;
  _rd[1] = dy;
  _rd[2] = dz;
  _rlo[0] = b.minX;
  _rlo[1] = b.minY;
  _rlo[2] = b.minZ;
  _rhi[0] = b.maxX;
  _rhi[1] = b.maxY;
  _rhi[2] = b.maxZ;
  for (let i = 0; i < 3; i++) {
    const o = _ro[i];
    const d = _rd[i];
    const lo = _rlo[i];
    const hi = _rhi[i];
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
  const inside = tmin < 0; // origin inside box
  _rayRes.t = inside ? 0 : tmin;
  _rayRes.nx = inside ? 0 : nx;
  _rayRes.ny = inside ? 0 : ny;
  _rayRes.nz = inside ? 0 : nz;
  return _rayRes;
}
