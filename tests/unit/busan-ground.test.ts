import { describe, expect, it } from 'vitest';
import { Footprints, Ground, HeightGrid, STEP_UP } from '../../busan/src/Ground';

/** buildings.bin과 같은 배치: [M, P] i32 · zb[M] · zt[M] f32 · n[M] i32 · xy[2P] f32 */
function buildingsBin(list: { zb: number; zt: number; ring: [number, number][] }[]): ArrayBuffer {
  const m = list.length;
  const p = list.reduce((s, b) => s + b.ring.length, 0);
  const buf = new ArrayBuffer(8 + m * 12 + p * 8);
  new Int32Array(buf, 0, 2).set([m, p]);
  new Float32Array(buf, 8, m).set(list.map((b) => b.zb));
  new Float32Array(buf, 8 + m * 4, m).set(list.map((b) => b.zt));
  new Int32Array(buf, 8 + m * 8, m).set(list.map((b) => b.ring.length));
  new Float32Array(buf, 8 + m * 12, p * 2).set(list.flatMap((b) => b.ring.flat()));
  return buf;
}

const square = (x: number, y: number, s: number): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];

describe('HeightGrid', () => {
  // 3x2 격자, 간격 10m, 0.1m 단위: 행0 = 0,10,20m / 행1 = 5,15,25m
  const grid = new HeightGrid({ file: '', x0: 100, y0: 200, step: 10, nx: 3, ny: 2, scale: 0.1 }, new Int16Array([0, 100, 200, 50, 150, 250]));

  it('격자점과 사이를 쌍선형 보간한다', () => {
    expect(grid.at(100, 200)).toBeCloseTo(0);
    expect(grid.at(120, 210)).toBeCloseTo(25);
    expect(grid.at(105, 205)).toBeCloseTo(7.5);
  });

  it('영역 밖은 NaN', () => {
    expect(grid.at(99, 200)).toBeNaN();
    expect(grid.at(100, 211)).toBeNaN();
  });

  it('크기가 맞지 않으면 거부한다', () => {
    expect(() => new HeightGrid({ file: '', x0: 0, y0: 0, step: 1, nx: 4, ny: 4, scale: 1 }, new Int16Array(3))).toThrow();
  });
});

describe('Ground (지형 + 건물)', () => {
  const height = new HeightGrid({ file: '', x0: 0, y0: 0, step: 100, nx: 3, ny: 3, scale: 0.1 }, new Int16Array([-50, -50, -50, 20, 20, 20, 20, 20, 20]));
  const buildings = new Footprints(
    buildingsBin([
      { zb: 1.5, zt: 40, ring: square(100, 120, 20) }, // 40m 건물
      { zb: 1.5, zt: 2.4, ring: square(150, 120, 10) }, // 계단 높이 단상(0.4m)
      { zb: 9, zt: 12, ring: square(100, 160, 10) }, // 떠 있는 구름다리(9~12m)
    ]),
  );
  const ground = new Ground();
  ground.add({ height, buildings });

  it('바다(음수 고도)는 수면 0으로 본다', () => {
    expect(ground.terrain(50, 0)).toBe(0);
    expect(ground.terrain(50, 150)).toBeCloseTo(2);
  });

  it('옥상 높이와 텔레포트 착지면', () => {
    expect(ground.top(110, 130)).toBe(40);
    expect(ground.top(130, 130)).toBeCloseTo(2);
  });

  it('높은 벽은 막고 계단 높이는 올라선다', () => {
    expect(ground.blocked(110, 130, 2)).toBe(true);
    expect(ground.blocked(155, 125, 2)).toBe(false);
    expect(ground.floor(155, 125, 2)).toBeCloseTo(2.4);
    expect(2.4 - 2).toBeLessThan(STEP_UP);
  });

  it('옥상 위에 서 있으면 그 건물에 막히지 않는다', () => {
    expect(ground.blocked(110, 130, 40)).toBe(false);
    expect(ground.floor(110, 130, 40)).toBe(40);
  });

  it('머리 위 구름다리는 지나가고, 같은 높이에서는 막힌다', () => {
    expect(ground.blocked(105, 165, 2)).toBe(false);
    expect(ground.blocked(105, 165, 8)).toBe(true);
  });

  it('잘못된 buildings.bin 크기를 거부한다', () => {
    expect(() => new Footprints(new ArrayBuffer(12))).toThrow();
  });
});
