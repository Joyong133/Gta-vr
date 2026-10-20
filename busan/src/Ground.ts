/**
 * 지면/건물 질의 (three.js 없이 순수 계산 — 단위 테스트 가능).
 * 좌표는 지도 좌표: x=동, y=북, z=위 (m).
 */
import type { HeightInfo } from './regions';

/** 상세 지형 높이 격자(Int16, scale m 단위). 영역 밖은 NaN. */
export class HeightGrid {
  constructor(
    readonly info: HeightInfo,
    readonly data: Int16Array,
  ) {
    if (data.length !== info.nx * info.ny) throw new Error(`height.bin 크기 불일치: ${data.length} != ${info.nx}x${info.ny}`);
  }

  contains(x: number, y: number): boolean {
    const { x0, y0, step, nx, ny } = this.info;
    return x >= x0 && y >= y0 && x <= x0 + step * (nx - 1) && y <= y0 + step * (ny - 1);
  }

  at(x: number, y: number): number {
    const { x0, y0, step, nx, ny, scale } = this.info;
    const fx = (x - x0) / step;
    const fy = (y - y0) / step;
    if (!(fx >= 0 && fy >= 0 && fx <= nx - 1 && fy <= ny - 1)) return NaN;
    const ix = Math.min(Math.floor(fx), nx - 2);
    const iy = Math.min(Math.floor(fy), ny - 2);
    const tx = fx - ix;
    const ty = fy - iy;
    const d = this.data;
    const i = iy * nx + ix;
    const h = d[i] * (1 - tx) * (1 - ty) + d[i + 1] * tx * (1 - ty) + d[i + nx] * (1 - tx) * ty + d[i + nx + 1] * tx * ty;
    return h * scale;
  }
}

const CELL = 64;

/**
 * 건물 외곽선(buildings.bin): [M, P] int32 · zb[M] f32 · zt[M] f32 · n[M] i32 · xy[2P] f32
 * 균일 격자로 후보를 좁힌 뒤 점-다각형 판정을 한다.
 */
export class Footprints {
  readonly count: number;
  readonly zb: Float32Array;
  readonly zt: Float32Array;
  readonly n: Int32Array;
  readonly start: Int32Array;
  readonly xy: Float32Array;
  private readonly cells = new Map<number, number[]>();

  constructor(buf: ArrayBuffer) {
    const head = new Int32Array(buf, 0, 2);
    const m = head[0];
    const p = head[1];
    const expected = 8 + m * 12 + p * 8;
    if (buf.byteLength !== expected) throw new Error(`buildings.bin 크기 불일치: ${buf.byteLength} != ${expected}`);
    this.count = m;
    this.zb = new Float32Array(buf, 8, m);
    this.zt = new Float32Array(buf, 8 + m * 4, m);
    this.n = new Int32Array(buf, 8 + m * 8, m);
    this.xy = new Float32Array(buf, 8 + m * 12, p * 2);
    this.start = new Int32Array(m);
    let s = 0;
    for (let i = 0; i < m; i++) {
      this.start[i] = s;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let k = 0; k < this.n[i]; k++) {
        const x = this.xy[(s + k) * 2];
        const y = this.xy[(s + k) * 2 + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      s += this.n[i];
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
        for (let cy = Math.floor(minY / CELL); cy <= Math.floor(maxY / CELL); cy++) {
          const key = cellKey(cx, cy);
          const list = this.cells.get(key);
          if (list) list.push(i);
          else this.cells.set(key, [i]);
        }
      }
    }
  }

  /** (x, y)를 포함하는 건물 번호들. */
  containing(x: number, y: number, out: number[] = []): number[] {
    out.length = 0;
    const list = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!list) return out;
    for (const i of list) if (this.inside(i, x, y)) out.push(i);
    return out;
  }

  private inside(i: number, x: number, y: number): boolean {
    const s = this.start[i];
    const n = this.n[i];
    const xy = this.xy;
    let c = false;
    for (let a = 0, b = n - 1; a < n; b = a++) {
      const ax = xy[(s + a) * 2], ay = xy[(s + a) * 2 + 1];
      const bx = xy[(s + b) * 2], by = xy[(s + b) * 2 + 1];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) c = !c;
    }
    return c;
  }
}

function cellKey(cx: number, cy: number): number {
  return (cx + 32768) * 65536 + (cy + 32768);
}

/** 계단 정도는 그냥 올라간다(m). */
export const STEP_UP = 0.7;
/** 몸 높이(충돌 판정, m). */
export const BODY = 1.7;

export interface GroundPart {
  height: HeightGrid;
  buildings: Footprints;
}

/** 여러 지역을 함께 다룬다(공통 좌표계라 그대로 겹쳐 쓸 수 있다). */
export class Ground {
  readonly parts: GroundPart[] = [];
  private readonly tmp: number[] = [];

  add(part: GroundPart): void {
    this.parts.push(part);
  }

  /** 지형 높이. 바다(음수)는 수면 0으로 본다. 지역 밖은 0. */
  terrain(x: number, y: number): number {
    for (const p of this.parts) {
      const h = p.height.at(x, y);
      if (!Number.isNaN(h)) return Math.max(h, 0);
    }
    return 0;
  }

  /** 가장 높은 표면(옥상 포함) — 텔레포트 착지/비행 최저 고도. */
  top(x: number, y: number): number {
    let z = this.terrain(x, y);
    for (const p of this.parts) {
      for (const i of p.buildings.containing(x, y, this.tmp)) z = Math.max(z, p.buildings.zt[i]);
    }
    return z;
  }

  /** 발 높이 feet에서 디딜 수 있는 가장 높은 표면(STEP_UP까지 올라감). */
  floor(x: number, y: number, feet: number): number {
    let z = this.terrain(x, y);
    for (const p of this.parts) {
      for (const i of p.buildings.containing(x, y, this.tmp)) {
        const t = p.buildings.zt[i];
        if (t <= feet + STEP_UP && t > z) z = t;
      }
    }
    return z;
  }

  /** 발 높이 feet로 (x, y)에 서면 건물 벽에 막히는가. */
  blocked(x: number, y: number, feet: number, body = BODY): boolean {
    for (const p of this.parts) {
      for (const i of p.buildings.containing(x, y, this.tmp)) {
        if (p.buildings.zt[i] > feet + STEP_UP && p.buildings.zb[i] < feet + body) return true;
      }
    }
    return false;
  }
}
