/** Small math helpers shared by gameplay code. Pure functions, no allocation. */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

/** Frame-rate independent exponential smoothing factor. */
export function dampFactor(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, dampFactor(lambda, dt));
}

/** Moves `current` toward `target` by at most `maxDelta`. */
export function moveToward(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Applies a radial dead zone to a 2D stick and rescales the remainder to 0..1. */
export function applyDeadzone(x: number, y: number, deadzone: number, out: { x: number; y: number }): { x: number; y: number } {
  const len = Math.hypot(x, y);
  if (len < deadzone) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const scaled = Math.min(1, (len - deadzone) / (1 - deadzone));
  out.x = (x / len) * scaled;
  out.y = (y / len) * scaled;
  return out;
}

/** Yaw (rotation about +Y) of a forward vector where forward is -Z. */
export function yawFromForward(fx: number, fz: number): number {
  return Math.atan2(-fx, -fz);
}

export function distSq2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt(distSq2(ax, az, bx, bz));
}

/** Deterministic PRNG (mulberry32) so the procedural city is identical every run. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

export function randRange(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}
