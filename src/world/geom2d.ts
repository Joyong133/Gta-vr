/**
 * 2D (XZ plane) collision helpers used by the player, NPCs and AI cars.
 * The city is mostly axis-aligned boxes, so cheap analytic tests are enough.
 */

export interface Vec2Like {
  x: number;
  z: number;
}

export interface Obb2 {
  cx: number;
  cz: number;
  /** Yaw in radians; local forward is -Z, local right is +X. */
  yaw: number;
  halfW: number; // along local X
  halfL: number; // along local Z
}

/** Scratch for circleVsObb (hot path: no per-call allocation). */
const _cTmp: Vec2Like = { x: 0, z: 0 };
/** Scratch separating axes for the OBB SAT tests. */
const _ax = new Float64Array(4);
const _az = new Float64Array(4);

/** Circle vs axis-aligned rectangle. Returns penetration push (written to out) or false. */
export function circleVsAabb(
  px: number,
  pz: number,
  r: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  out: Vec2Like,
): boolean {
  const cx = px < minX ? minX : px > maxX ? maxX : px;
  const cz = pz < minZ ? minZ : pz > maxZ ? maxZ : pz;
  let dx = px - cx;
  let dz = pz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r) return false;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    const push = r - d;
    out.x = (dx / d) * push;
    out.z = (dz / d) * push;
    return true;
  }
  // Centre inside the box: push out along the axis of least penetration.
  const left = px - minX;
  const right = maxX - px;
  const top = pz - minZ;
  const bottom = maxZ - pz;
  const m = Math.min(left, right, top, bottom);
  dx = 0;
  dz = 0;
  if (m === left) dx = -(left + r);
  else if (m === right) dx = right + r;
  else if (m === top) dz = -(top + r);
  else dz = bottom + r;
  out.x = dx;
  out.z = dz;
  return true;
}

/** Circle vs oriented box. Push is applied to the circle. */
export function circleVsObb(px: number, pz: number, r: number, b: Obb2, out: Vec2Like): boolean {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  // World -> local (rotation by -yaw about Y). Three.js yaw rotates +X toward -Z.
  const dx = px - b.cx;
  const dz = pz - b.cz;
  const lx = c * dx - s * dz;
  const lz = s * dx + c * dz;
  const tmp = _cTmp;
  if (!circleVsAabb(lx, lz, r, -b.halfW, -b.halfL, b.halfW, b.halfL, tmp)) return false;
  // Local -> world (rotation by +yaw).
  out.x = c * tmp.x + s * tmp.z;
  out.z = -s * tmp.x + c * tmp.z;
  return true;
}

/** World-space unit axes of an OBB. */
export function obbAxes(b: Obb2): { rx: number; rz: number; fx: number; fz: number } {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  // Local +X rotated by yaw: (c, -s); local -Z (forward) rotated by yaw: (-s, -c)
  return { rx: c, rz: -s, fx: -s, fz: -c };
}

/** Half extent of an OBB (axes right = (c, -s), forward = (-s, -c)) projected on unit axis (ax, az). */
function projectObb(halfW: number, halfL: number, c: number, s: number, ax: number, az: number): number {
  return halfW * Math.abs(c * ax - s * az) + halfL * Math.abs(s * ax + c * az);
}

/**
 * Separating-axis test between an OBB and an AABB.
 * Writes the minimum translation (to apply to the OBB) into out.
 */
export function obbVsAabb(b: Obb2, minX: number, minZ: number, maxX: number, maxZ: number, out: Vec2Like): boolean {
  const acx = (minX + maxX) / 2;
  const acz = (minZ + maxZ) / 2;
  const ahx = (maxX - minX) / 2;
  const ahz = (maxZ - minZ) / 2;
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  // Axes: world X, world Z, OBB right (c, -s), OBB forward (-s, -c).
  _ax[0] = 1;
  _az[0] = 0;
  _ax[1] = 0;
  _az[1] = 1;
  _ax[2] = c;
  _az[2] = -s;
  _ax[3] = -s;
  _az[3] = -c;
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  const dx = b.cx - acx;
  const dz = b.cz - acz;
  for (let i = 0; i < 4; i++) {
    const ax = _ax[i];
    const az = _az[i];
    const ra = ahx * Math.abs(ax) + ahz * Math.abs(az);
    const rb = projectObb(b.halfW, b.halfL, c, s, ax, az);
    const dist = dx * ax + dz * az;
    const overlap = ra + rb - Math.abs(dist);
    if (overlap <= 0) return false;
    if (overlap < best) {
      best = overlap;
      const sign = dist < 0 ? -1 : 1;
      bx = ax * overlap * sign;
      bz = az * overlap * sign;
    }
  }
  out.x = bx;
  out.z = bz;
  return true;
}

/** OBB vs OBB separating-axis test. MTV applies to `a`. */
export function obbVsObb(a: Obb2, b: Obb2, out: Vec2Like): boolean {
  const ca = Math.cos(a.yaw);
  const sa = Math.sin(a.yaw);
  const cb = Math.cos(b.yaw);
  const sb = Math.sin(b.yaw);
  // Axes: a right, a forward, b right, b forward.
  _ax[0] = ca;
  _az[0] = -sa;
  _ax[1] = -sa;
  _az[1] = -ca;
  _ax[2] = cb;
  _az[2] = -sb;
  _ax[3] = -sb;
  _az[3] = -cb;
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  const dx = a.cx - b.cx;
  const dz = a.cz - b.cz;
  for (let i = 0; i < 4; i++) {
    const ax = _ax[i];
    const az = _az[i];
    const ra = projectObb(a.halfW, a.halfL, ca, sa, ax, az);
    const rb = projectObb(b.halfW, b.halfL, cb, sb, ax, az);
    const dist = dx * ax + dz * az;
    const overlap = ra + rb - Math.abs(dist);
    if (overlap <= 0) return false;
    if (overlap < best) {
      best = overlap;
      const sign = dist < 0 ? -1 : 1;
      bx = ax * overlap * sign;
      bz = az * overlap * sign;
    }
  }
  out.x = bx;
  out.z = bz;
  return true;
}

/** Converts a world point into an OBB's local frame (x = right, z = back, so forward distance = -z). */
export function toObbLocal(b: Obb2, px: number, pz: number, out: Vec2Like): Vec2Like {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const dx = px - b.cx;
  const dz = pz - b.cz;
  out.x = c * dx - s * dz;
  out.z = s * dx + c * dz;
  return out;
}
