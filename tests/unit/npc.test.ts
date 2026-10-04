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
import { obbVsObb } from '../../src/world/geom2d';
import { RoadNetwork } from '../../src/world/RoadNetwork';
import { StaticWorld } from '../../src/world/StaticWorld';

const H = 1 / 60;

function cityStatics(): StaticWorld {
  const w = new StaticWorld();
  for (const b of BUILDINGS) w.add(b.minX, 0, b.minZ, b.maxX, b.height, b.maxZ, { blocksSight: true });
  return w;
}

/** Eastbound road lane on z=0 that ends at the lit (0,0) junction. */
function eastboundIntoCentre(roads: RoadNetwork) {
  const node = roads.nodeAt(0, 0);
  const lane = roads.roadLanes.find((l) => l.node === node && l.axis === 'ew' && l.points[0].x < 0);
  if (!lane) throw new Error('lane not found');
  return lane;
}

function makeTraffic(roads: RoadNetwork, s: number) {
  const scene = new THREE.Scene();
  const world = new CANNON.World();
  const lane = eastboundIntoCentre(roads);
  const car = new AICar(scene, world, 'traffic_t', 'traffic', 0xff0000);
  const tc = new TrafficCar(car, lane, s, () => 0.5);
  const p = { x: 0, z: 0 };
  const d = { x: 0, z: 0 };
  roads.sample(lane, s, p, d);
  car.setPose(p.x, p.z, Math.atan2(-d.x, -d.z));
  car.speed = 8;
  return { tc, lane, car };
}

describe('Traffic', () => {
  it('stops at a red light before the stop line and goes on green', () => {
    const roads = new RoadNetwork();
    const movers = new Movers();
    const { tc, lane, car } = makeTraffic(roads, 40);
    const node = lane.node;
    // Find a time window where 'ew' is red for at least 12 s.
    let t0 = 0;
    while (roads.lightState(node, 'ew', t0) !== 'red' || roads.lightState(node, 'ew', t0 + 12) !== 'red') t0 += 0.25;
    let t = t0;
    for (let i = 0; i < 60 * 10; i++) {
      movers.clear();
      movers.cars.push({ id: car.id, kind: 'traffic', obb: car.obb, speed: car.speed });
      tc.fixedUpdate(H, roads, movers, t, () => undefined);
      car.commitStep(H);
      t += H;
    }
    expect(tc.lane).toBe(lane);
    expect(car.speed).toBeLessThan(0.3);
    expect(tc.s).toBeLessThan(lane.length - 3.0);
    expect(tc.state).toBe('wait_light');
    // Run until the light turns green and the car leaves the lane.
    for (let i = 0; i < 60 * 30 && tc.lane === lane; i++) {
      movers.clear();
      movers.cars.push({ id: car.id, kind: 'traffic', obb: car.obb, speed: car.speed });
      tc.fixedUpdate(H, roads, movers, t, () => undefined);
      car.commitStep(H);
      t += H;
    }
    expect(tc.lane).not.toBe(lane);
  });

  it('keeps distance, honks and overtakes a car blocking its lane', () => {
    const roads = new RoadNetwork();
    const movers = new Movers();
    const { tc, lane, car } = makeTraffic(roads, 10);
    const p = { x: 0, z: 0 };
    const d = { x: 0, z: 0 };
    roads.sample(lane, 40, p, d);
    // A parked player car sits in the lane 30 m ahead.
    const blocker = { id: 'player_car', kind: 'player_car' as const, obb: { cx: p.x, cz: p.z, yaw: Math.atan2(-d.x, -d.z), halfW: 0.95, halfL: 2.25 }, speed: 0 };
    let honks = 0;
    let minGap = Infinity;
    let offsetSeen = 0;
    let overlapped = false;
    for (let i = 0; i < 60 * 25; i++) {
      movers.clear();
      movers.cars.push(blocker, { id: car.id, kind: 'traffic', obb: car.obb, speed: car.speed });
      tc.fixedUpdate(H, roads, movers, 0, () => honks++);
      car.commitStep(H);
      // Before swinging out, it must keep its distance behind the blocker.
      if (tc.lane === lane && tc.offset > -0.5) minGap = Math.min(minGap, Math.hypot(car.x - p.x, car.z - p.z));
      if (obbVsObb(car.obb, blocker.obb, { x: 0, z: 0 })) overlapped = true;
      offsetSeen = Math.min(offsetSeen, tc.offset);
    }
    expect(overlapped).toBe(false); // never drove into the blocker
    expect(minGap).toBeGreaterThan(4.6); // queued behind it with a gap
    expect(honks).toBeGreaterThan(0);
    expect(offsetSeen).toBeLessThan(-2.5); // pulled into the other lane to pass
    expect(tc.lane === lane ? tc.s : Infinity).toBeGreaterThan(40); // got past it
  });
});

describe('Pedestrians', () => {
  it('turns around when its sidewalk is completely blocked', () => {
    const world = new StaticWorld();
    const movers = new Movers();
    const route = [
      { x: 0, z: 0 },
      { x: 40, z: 0 },
    ];
    const model = new PedModel({ shirt: 0xff0000, pants: 0, skin: 0xffffff, hair: 0 });
    const ped = new Pedestrian('p', model, route, 0, () => 0.0);
    ped.x = 5;
    ped.z = 0;
    // A car parked across the walkway at x=10 with walls on both sides of it.
    world.add(9, 0, -6, 11, 2, -1.2);
    world.add(9, 0, 1.2, 11, 2, 6);
    const car = { cx: 10, cz: 0, yaw: Math.PI / 2, halfW: 0.95, halfL: 2.25 };
    for (let i = 0; i < 60 * 12; i++) ped.update(H, world, movers, [car], [ped], i * H);
    expect(ped.stuckTurnarounds).toBeGreaterThan(0);
    expect(ped.x).toBeLessThan(10); // never walked through the car
  });

  it('flees from danger and gets up after being knocked down', () => {
    const world = new StaticWorld();
    const movers = new Movers();
    const model = new PedModel({ shirt: 0xff0000, pants: 0, skin: 0xffffff, hair: 0 });
    const ped = new Pedestrian('p', model, [{ x: 0, z: 0 }, { x: 30, z: 0 }], 0, () => 0.9);
    ped.x = 10;
    ped.z = 0;
    ped.scare(8, 0, 1);
    expect(ped.state).toBe('flee');
    for (let i = 0; i < 60; i++) ped.update(H, world, movers, [], [ped], i * H);
    expect(ped.x).toBeGreaterThan(11); // ran away from x=8
    ped.knockDown(ped.x - 1, 0);
    expect(ped.state).toBe('knocked');
    for (let i = 0; i < 60 * (tuning.pedestrians.knockedTime + 1.5); i++) ped.update(H, world, movers, [], [ped], i * H);
    expect(['flee', 'walk']).toContain(ped.state);
  });
});

describe('Police', () => {
  function setup() {
    const scene = new THREE.Scene();
    const world = new CANNON.World();
    const roads = new RoadNetwork();
    const statics = cityStatics();
    const movers = new Movers();
    const wanted = new WantedSystem();
    const police = new PoliceManager(scene, world, roads, statics, movers, wanted);
    return { police, wanted, movers, statics };
  }

  it('witnesses crimes only with line of sight', () => {
    const { police } = setup();
    const officer = police.officers[0];
    officer.x = 0;
    officer.z = -8;
    officer.yaw = 0; // facing -Z (north) up the avenue
    expect(police.witnesses(0, -40)).toBe(true); // straight up the road
    expect(police.witnesses(-45, -40)).toBe(false); // behind the plaza buildings / out of FOV
  });

  it('pursues when it sees the player, then searches the last known position', () => {
    const { police, wanted, movers } = setup();
    const officer = police.officers[0];
    officer.x = 0;
    officer.z = -8;
    officer.yaw = 0;
    wanted.force(1, 0, -30);
    movers.playerX = 0;
    movers.playerZ = -25;
    movers.playerOnFoot = true;
    const viewer = new THREE.Vector3(0, 1.6, -25);
    for (let i = 0; i < 20; i++) police.update(H, viewer);
    expect(officer.state).toBe('pursue');
    expect(officer.sees).toBe(true);
    // Player ducks behind a building: no more sightings, LKP stays where they were seen.
    movers.playerX = -60;
    movers.playerZ = -90;
    viewer.set(-60, 1.6, -90);
    const lkpX = wanted.lkpX;
    for (let i = 0; i < 60 * (tuning.police.lostSightTime + 1); i++) {
      police.update(H, viewer);
      wanted.update(H, movers.playerX, movers.playerZ);
    }
    expect(officer.sees).toBe(false);
    expect(officer.state).toBe('search');
    expect(wanted.lkpX).toBe(lkpX); // police did not magically learn the new position
    expect(wanted.searching).toBe(true);
  });

  it('stands down when the wanted level clears', () => {
    const { police, wanted, movers } = setup();
    wanted.force(2, 50, 50);
    movers.playerX = -140;
    movers.playerZ = -140;
    const viewer = new THREE.Vector3(-140, 1.6, -140);
    for (let i = 0; i < 30; i++) police.update(H, viewer);
    expect(police.cars.slice(0, 2).every((c) => c.state === 'respond' || c.state === 'search')).toBe(true);
    wanted.clear();
    for (let i = 0; i < 5; i++) police.update(H, viewer);
    expect(police.units.every((u) => !['respond', 'pursue', 'search'].includes(u.state))).toBe(true);
  });
});
