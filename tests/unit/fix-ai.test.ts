import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { tuning } from '../../src/config/tuning';
import { PedModel } from '../../src/npc/PedModel';
import { Pedestrian } from '../../src/npc/PedestrianManager';
import { PoliceManager } from '../../src/police/PoliceManager';
import { WantedSystem } from '../../src/police/WantedSystem';
import { AICar } from '../../src/traffic/AICar';
import { Movers } from '../../src/traffic/Movers';
import { TrafficCar } from '../../src/traffic/TrafficManager';
import { BUILDINGS } from '../../src/world/CityLayout';
import { circleVsObb, obbVsAabb, obbVsObb, type Obb2 } from '../../src/world/geom2d';
import { RoadNetwork } from '../../src/world/RoadNetwork';
import { StaticWorld } from '../../src/world/StaticWorld';

const H = 1 / 60;
/** Inside the HOTEL ORBIT tower: no police unit can see the player there. */
const HIDDEN = { x: -89, z: -85 };

function cityStatics(): StaticWorld {
  const w = new StaticWorld();
  for (const b of BUILDINGS) w.add(b.minX, 0, b.minZ, b.maxX, b.height, b.maxZ, { blocksSight: true });
  return w;
}

function policeSetup(statics = cityStatics()) {
  const roads = new RoadNetwork();
  const movers = new Movers();
  const wanted = new WantedSystem();
  const police = new PoliceManager(new THREE.Scene(), new CANNON.World(), roads, statics, movers, wanted);
  return { police, wanted, movers, roads, statics };
}

/** One game frame in the order Game uses: movers snapshot, physics step, then perception / decisions. */
function frame(police: PoliceManager, movers: Movers, wanted: WantedSystem, viewer: THREE.Vector3, px = HIDDEN.x, pz = HIDDEN.z): void {
  movers.clear();
  movers.playerX = px;
  movers.playerZ = pz;
  police.publish();
  police.fixedUpdate(H);
  police.update(H, viewer);
  wanted.cooldown = 0; // keep the level for the whole run
}

describe('Police car navigation (C11)', () => {
  it('a car dispatched from the precinct lot reaches an off-road sidewalk LKP in another block', () => {
    const { police, wanted, movers } = policeSetup();
    const viewer = new THREE.Vector3(HIDDEN.x, 1.6, HIDDEN.z);
    // NEON 24 forecourt, 11.5 m off the z=0 road, NE block (the lot is in the SE block).
    const lkp = { x: 51, z: -14.5 };
    wanted.force(2, lkp.x, lkp.z);
    wanted.timeSinceSeen = 10; // nobody sees the player: a pure LKP response
    const car = police.cars[1];
    let minD = Infinity;
    let searchedAt = -1;
    for (let f = 0; f < 60 * 40 && searchedAt < 0; f++) {
      frame(police, movers, wanted, viewer);
      minD = Math.min(minD, Math.hypot(car.x - lkp.x, car.z - lkp.z));
      if (car.state === 'search') searchedAt = f / 60;
    }
    expect(minD).toBeLessThan(12);
    expect(searchedAt).toBeGreaterThan(0);
  });

  it('the patrol car responds across the map to a sidewalk LKP instead of circling a junction', () => {
    const { police, wanted, movers } = policeSetup();
    const viewer = new THREE.Vector3(HIDDEN.x, 1.6, HIDDEN.z);
    // East sidewalk of the SW block; car 0 starts on the north perimeter road.
    const lkp = { x: -8, z: 80 };
    wanted.force(1, lkp.x, lkp.z);
    wanted.timeSinceSeen = 10;
    const car = police.cars[0];
    expect(Math.hypot(car.x - lkp.x, car.z - lkp.z)).toBeGreaterThan(150);
    let minD = Infinity;
    for (let f = 0; f < 60 * 40; f++) {
      frame(police, movers, wanted, viewer);
      minD = Math.min(minD, Math.hypot(car.x - lkp.x, car.z - lkp.z));
    }
    expect(minD).toBeLessThan(12);
    expect(car.state).toBe('search');
  });

  it('a returning car drives back into the precinct lot and parks', () => {
    const { police, wanted, movers } = policeSetup();
    const viewer = new THREE.Vector3(HIDDEN.x, 1.6, HIDDEN.z);
    const car = police.cars[1];
    car.car.setPose(0, 40, 0); // on the x=0 road, heading north, away from home
    car.state = 'return';
    car.targetX = car.home.x;
    car.targetZ = car.home.z;
    expect(wanted.level).toBe(0);
    let parkedAt = -1;
    for (let f = 0; f < 60 * 60 && parkedAt < 0; f++) {
      frame(police, movers, wanted, viewer);
      if ((car.state as string) === 'idle') parkedAt = f / 60;
    }
    expect(parkedAt).toBeGreaterThan(0);
    expect(Math.hypot(car.x - car.home.x, car.z - car.home.z)).toBeLessThan(0.5);
  });

  it('does not drive straight into a thin pole that sits between sparse rays', () => {
    // Straight line to the target is blocked only by a 0.3 m pole on the car's flank.
    const statics = new StaticWorld();
    statics.addCentered(-0.6, 2, -20, 0.3, 4, 0.3, { blocksSight: false, tag: 'lamp' });
    expect(statics.isCorridorBlocked(0, 0, 0, -40, 1.1)).toBe(true);
    expect(statics.isCorridorBlocked(3, 0, 3, -40, 1.1)).toBe(false);
    // The pole is between the old centre ray (x=0) and left ray (x=-1.1): rays alone miss it.
    expect(statics.raycast(0, 0.8, 0, 0, 0, -1, 40)).toBeNull();
    expect(statics.raycast(-1.1, 0.8, 0, 0, 0, -1, 40)).toBeNull();
  });
});

describe('Police state machine', () => {
  it('C12: an undispatched car still returning when a new crime comes in arrives and parks', () => {
    const { police, wanted, movers } = policeSetup();
    const viewer = new THREE.Vector3(HIDDEN.x, 1.6, HIDDEN.z);
    wanted.force(1, -60, -60); // level 1 dispatches car 0 only
    wanted.timeSinceSeen = 10;
    const car = police.cars[1];
    car.car.setPose(52, 106, 0);
    car.state = 'return';
    car.targetX = car.home.x;
    car.targetZ = car.home.z;
    car.desiredSpeed = 9;
    for (let f = 0; f < 60 * 15 && car.state === 'return'; f++) frame(police, movers, wanted, viewer);
    expect(wanted.level).toBe(1);
    expect(car.state).toBe('idle');
  });

  it('C13: an officer who lost sight heads for the last seen point, not the hidden player', () => {
    const { police, wanted, movers } = policeSetup();
    const officer = police.officers[0];
    officer.x = 0;
    officer.z = -8;
    officer.yaw = 0;
    wanted.force(1, 0, -30);
    movers.playerOnFoot = true;
    const viewer = new THREE.Vector3(0, 1.6, -25);
    for (let i = 0; i < 20; i++) {
      movers.clear();
      movers.playerX = 0;
      movers.playerZ = -25;
      police.update(H, viewer);
    }
    expect(officer.state).toBe('pursue');
    // The player slips away behind the plaza buildings (west); the officer must not track them.
    const x0 = officer.x;
    for (let i = 0; i < 60; i++) {
      movers.clear();
      movers.playerX = -60;
      movers.playerZ = -90;
      police.update(H, viewer);
    }
    expect(officer.sees).toBe(false);
    expect(officer.state).toBe('pursue'); // still within lostSightTime
    expect(Math.abs(officer.x - x0)).toBeLessThan(0.5); // ran up the road toward (0,-25), not west
  });

  it('C13: no arrest through a wall while a pursuit is kept alive without sight', () => {
    const statics = new StaticWorld();
    statics.add(-3, 0, 0.6, 3, 3, 0.8, { blocksSight: true }); // thin wall between officer and player
    const { police, wanted, movers } = policeSetup(statics);
    let busted = 0;
    police.onBusted = () => busted++;
    const officer = police.officers[0];
    officer.x = 0;
    officer.z = 0;
    officer.state = 'pursue';
    officer.lastSeen = 0;
    officer.targetX = 0;
    officer.targetZ = 0;
    wanted.force(1, 0, 1.4);
    movers.playerOnFoot = true;
    const viewer = new THREE.Vector3(0, 1.6, 1.4);
    for (let i = 0; i < 60 * 2; i++) {
      movers.clear();
      movers.playerX = 0;
      movers.playerZ = 1.4;
      police.update(H, viewer);
    }
    expect(officer.distToPlayer).toBeLessThan(tuning.police.arrestDistance);
    expect(officer.sees).toBe(false);
    expect(busted).toBe(0);
    expect(police.arrestProgress).toBe(0);
  });

  it('sirenUnits lists only active cars, nearest first', () => {
    const { police } = policeSetup();
    const [a, b, c] = police.cars;
    a.state = 'pursue';
    b.state = 'idle';
    c.state = 'search';
    a.car.setPose(100, 0, 0);
    c.car.setPose(10, 0, 0);
    const viewer = new THREE.Vector3(0, 0, 0);
    expect(police.sirenUnits(viewer).map((u) => u.id)).toEqual([c.id, a.id]);
    b.state = 'respond';
    b.car.setPose(50, 0, 0);
    expect(police.sirenUnits(viewer).map((u) => u.id)).toEqual([c.id, b.id, a.id]);
  });
});

describe('WantedSystem.reset (C21)', () => {
  it('drops to 0 without the "escaped" callback but still reports the change', () => {
    const w = new WantedSystem();
    const changes: [number, number][] = [];
    let cleared = 0;
    w.onChanged = (l, p) => changes.push([l, p]);
    w.onCleared = () => cleared++;
    w.force(2, 10, 10);
    changes.length = 0;
    w.reset();
    expect(w.level).toBe(0);
    expect(w.hasLkp).toBe(false);
    expect(w.searching).toBe(false);
    expect(cleared).toBe(0);
    expect(changes).toEqual([[0, 2]]);
    w.reset(); // already 0: nothing to report
    expect(changes).toEqual([[0, 2]]);
  });
});

describe('Traffic knock (C14)', () => {
  it('a rammed traffic car is visibly shoved off its lane, then eases back', () => {
    const roads = new RoadNetwork();
    const lane = roads.roadLanes.find((l) => l.axis === 'ew' && l.length > 80)!;
    const make = (id: string) => {
      const car = new AICar(new THREE.Scene(), new CANNON.World(), id, 'traffic', 0xff0000);
      const tc = new TrafficCar(car, lane, 30, () => 0.5);
      const p = { x: 0, z: 0 };
      const d = { x: 0, z: 0 };
      roads.sample(lane, 30, p, d);
      car.setPose(p.x, p.z, Math.atan2(-d.x, -d.z));
      car.speed = 8;
      tc.stun(2.5);
      return tc;
    };
    const hit = make('hit');
    const ref = make('ref');
    hit.car.knock(3.6, 3.6, 0.3); // what Game.onCarImpact does for a ~12 m/s hit
    const movers = new Movers();
    const step = () => {
      for (const tc of [hit, ref]) {
        tc.fixedUpdate(H, roads, movers, 0, () => undefined);
        tc.car.commitStep(H);
      }
    };
    for (let i = 0; i < 60; i++) step();
    const shove = Math.hypot(hit.car.x - ref.car.x, hit.car.z - ref.car.z);
    expect(shove).toBeGreaterThan(0.8);
    expect(Math.abs(hit.car.yaw - ref.car.yaw)).toBeGreaterThan(0.05);
    // Recovered and driving again: the offset decays back onto the lane.
    for (let i = 0; i < 60 * 8; i++) step();
    expect(hit.state).not.toBe('stunned');
    expect(Math.hypot(hit.car.x - ref.car.x, hit.car.z - ref.car.z)).toBeLessThan(0.1);
  });
});

describe('Pedestrian knock-down direction (C15)', () => {
  it('falls away from the impact', () => {
    const model = new PedModel({ shirt: 0xff0000, pants: 0, skin: 0xffffff, hair: 0 });
    const ped = new Pedestrian('p', model, [{ x: 0, z: 0 }, { x: 30, z: 0 }], 0, () => 0.9);
    ped.x = 10;
    ped.z = 5;
    const from = { x: 7, z: 9 }; // car came from up-left
    ped.knockDown(from.x, from.z);
    const world = new StaticWorld();
    for (let i = 0; i < 30; i++) ped.update(H, world, new Movers(), [], [ped], i * H);
    expect(ped.state).toBe('knocked');
    model.root.updateMatrixWorld(true);
    const head = new THREE.Vector3(0, 1.6, 0).applyMatrix4(model.body.matrixWorld);
    const away = { x: ped.x - from.x, z: ped.z - from.z };
    const len = Math.hypot(away.x, away.z);
    // The head lies on the far side of the feet, as seen from the impact.
    expect(((head.x - ped.x) * away.x + (head.z - ped.z) * away.z) / len).toBeGreaterThan(1);
  });
});

describe('Allocation-free hot paths keep their results (C16 / C29)', () => {
  /** Reference SAT (the original allocating implementation). */
  function refAxes(b: Obb2) {
    const c = Math.cos(b.yaw);
    const s = Math.sin(b.yaw);
    return { rx: c, rz: -s, fx: -s, fz: -c };
  }
  function refProject(b: Obb2, ax: number, az: number) {
    const a = refAxes(b);
    return b.halfW * Math.abs(a.rx * ax + a.rz * az) + b.halfL * Math.abs(a.fx * ax + a.fz * az);
  }
  function refSat(axes: number[][], dx: number, dz: number, ra: (ax: number, az: number) => number, rb: (ax: number, az: number) => number) {
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    for (const [ax, az] of axes) {
      const dist = dx * ax + dz * az;
      const overlap = ra(ax, az) + rb(ax, az) - Math.abs(dist);
      if (overlap <= 0) return null;
      if (overlap < best) {
        best = overlap;
        const sign = dist < 0 ? -1 : 1;
        bx = ax * overlap * sign;
        bz = az * overlap * sign;
      }
    }
    return { x: bx, z: bz };
  }

  it('obbVsObb / obbVsAabb / circleVsObb match the reference on random inputs', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const out = { x: 0, z: 0 };
    let hits = 0;
    for (let i = 0; i < 2000; i++) {
      const a: Obb2 = { cx: rnd() * 4, cz: rnd() * 4, yaw: rnd() * 4, halfW: 0.5 + Math.abs(rnd()), halfL: 0.5 + Math.abs(rnd()) * 2 };
      const b: Obb2 = { cx: rnd() * 4, cz: rnd() * 4, yaw: rnd() * 4, halfW: 0.5 + Math.abs(rnd()), halfL: 0.5 + Math.abs(rnd()) * 2 };
      const aa = refAxes(a);
      const ba = refAxes(b);
      const e1 = refSat([[aa.rx, aa.rz], [aa.fx, aa.fz], [ba.rx, ba.rz], [ba.fx, ba.fz]], a.cx - b.cx, a.cz - b.cz, (x, z) => refProject(a, x, z), (x, z) => refProject(b, x, z));
      const g1 = obbVsObb(a, b, out);
      expect(g1).toBe(e1 !== null);
      if (e1) {
        hits++;
        expect(out.x).toBe(e1.x);
        expect(out.z).toBe(e1.z);
      }
      const minX = b.cx - b.halfW;
      const maxX = b.cx + b.halfW;
      const minZ = b.cz - b.halfL;
      const maxZ = b.cz + b.halfL;
      const e2 = refSat([[1, 0], [0, 1], [aa.rx, aa.rz], [aa.fx, aa.fz]], a.cx - (minX + maxX) / 2, a.cz - (minZ + maxZ) / 2, (x, z) => ((maxX - minX) / 2) * Math.abs(x) + ((maxZ - minZ) / 2) * Math.abs(z), (x, z) => refProject(a, x, z));
      const g2 = obbVsAabb(a, minX, minZ, maxX, maxZ, out);
      expect(g2).toBe(e2 !== null);
      if (e2) {
        expect(out.x).toBe(e2.x);
        expect(out.z).toBe(e2.z);
      }
      // circleVsObb: pushing the circle by the result separates it (touching) from the box.
      const px = rnd() * 4;
      const pz = rnd() * 4;
      if (circleVsObb(px, pz, 0.4, a, out)) expect(circleVsObb(px + out.x * 1.001, pz + out.z * 1.001, 0.4, a, { x: 0, z: 0 })).toBe(false);
    }
    expect(hits).toBeGreaterThan(100);
  });

  it('StaticWorld.raycast still returns the nearest hit (grid traversal + scratch slab test)', () => {
    const w = cityStatics();
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 300; i++) {
      const ox = rnd() * 140;
      const oz = rnd() * 140;
      const a = rnd() * Math.PI;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const hit = w.raycast(ox, 1, oz, dx, 0, dz, 200);
      // Brute force over every box.
      let best = Infinity;
      for (const b of w.boxes) {
        let t0 = 0;
        let t1 = 200;
        let ok = true;
        for (const [o, d, lo, hi] of [
          [ox, dx, b.minX, b.maxX],
          [1, 0, b.minY, b.maxY],
          [oz, dz, b.minZ, b.maxZ],
        ]) {
          if (Math.abs(d) < 1e-9) {
            if (o < lo || o > hi) ok = false;
            continue;
          }
          const ta = Math.min((lo - o) / d, (hi - o) / d);
          const tb = Math.max((lo - o) / d, (hi - o) / d);
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
        }
        if (ok && t0 <= t1) best = Math.min(best, t0);
      }
      if (best === Infinity) expect(hit).toBeNull();
      else expect(hit?.t).toBeCloseTo(best, 6);
    }
  });

  it('Movers reuses pooled records frame to frame', () => {
    const m = new Movers();
    const obb: Obb2 = { cx: 1, cz: 2, yaw: 0, halfW: 1, halfL: 2 };
    m.cars.push({ id: 'player_car', kind: 'player_car', obb, speed: 3 }); // literal pushes still work
    m.addCar('t1', 'traffic', obb, 4);
    m.addWalker(5, 6, 0.3);
    const car1 = m.cars[1];
    const walker0 = m.walkers[0];
    m.clear();
    m.cars.push({ id: 'player_car', kind: 'player_car', obb, speed: 0 });
    m.addCar('p1', 'police', obb, 7);
    m.addWalker(8, 9, 0.28);
    expect(m.cars[1]).toBe(car1);
    expect(m.cars[1]).toEqual({ id: 'p1', kind: 'police', obb, speed: 7 });
    expect(m.walkers[0]).toBe(walker0);
    expect(m.walkers[0]).toEqual({ x: 8, z: 9, r: 0.28 });
    expect(m.cars.length).toBe(2);
  });
});
