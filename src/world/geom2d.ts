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
  const tmp = { x: 0, z: 0 };
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

function projectObb(b: Obb2, ax: number, az: number): number {
  const a = obbAxes(b);
  return b.halfW * Math.abs(a.rx * ax + a.rz * az) + b.halfL * Math.abs(a.fx * ax + a.fz * az);
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
  const a = obbAxes(b);
  const axes = [
    [1, 0],
    [0, 1],
    [a.rx, a.rz],
    [a.fx, a.fz],
  ];
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  const dx = b.cx - acx;
  const dz = b.cz - acz;
  for (const [ax, az] of axes) {
    const ra = ahx * Math.abs(ax) + ahz * Math.abs(az);
    const rb = projectObb(b, ax, az);
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
  const aa = obbAxes(a);
  const ba = obbAxes(b);
  const axes = [
    [aa.rx, aa.rz],
    [aa.fx, aa.fz],
    [ba.rx, ba.rz],
    [ba.fx, ba.fz],
  ];
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  const dx = a.cx - b.cx;
  const dz = a.cz - b.cz;
  for (const [ax, az] of axes) {
    const ra = projectObb(a, ax, az);
    const rb = projectObb(b, ax, az);
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
