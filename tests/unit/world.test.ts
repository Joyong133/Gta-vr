import { describe, expect, it } from 'vitest';
import { BUILDINGS, CHECKPOINTS, ITEM_SPAWNS, SPAWNS, ZONES, isInZone, PLAYER_CAR_SPAWN, pedestrianRoutes } from '../../src/world/CityLayout';
import { circleVsObb, obbVsAabb, obbVsObb } from '../../src/world/geom2d';
import { RoadNetwork } from '../../src/world/RoadNetwork';
import { StaticWorld } from '../../src/world/StaticWorld';

function cityStatics(): StaticWorld {
  const w = new StaticWorld();
  for (const b of BUILDINGS) w.add(b.minX, 0, b.minZ, b.maxX, b.height, b.maxZ, { blocksSight: true });
  return w;
}

describe('StaticWorld', () => {
  it('pushes a walking circle out of a wall', () => {
    const w = new StaticWorld();
    w.add(0, 0, 0, 10, 5, 10);
    const p = { x: 10.1, z: 5 };
    expect(w.resolveCircle(p, 0.3)).toBe(true);
    expect(p.x).toBeCloseTo(10.3, 5);
    expect(w.isCircleBlocked(12, 5, 0.3)).toBe(false);
  });

  it('ignores low and overhead boxes for walking', () => {
    const w = new StaticWorld();
    w.add(0, 0, 0, 2, 0.2, 2); // kerb-height
    w.add(0, 3, 0, 2, 4, 2); // canopy
    expect(w.isCircleBlocked(1, 1, 0.3)).toBe(false);
  });

  it('ray casts through the grid and reports the nearest hit', () => {
    const w = new StaticWorld();
    w.add(20, 0, -1, 22, 5, 1);
    w.add(40, 0, -1, 42, 5, 1);
    const h = w.raycast(0, 1, 0, 1, 0, 0, 100);
    expect(h).not.toBeNull();
    expect(h!.t).toBeCloseTo(20, 5);
    expect(h!.nx).toBe(-1);
    expect(w.raycast(0, 1, 0, -1, 0, 0, 100)).toBeNull();
  });

  it('line of sight is blocked by buildings in the real layout', () => {
    const w = cityStatics();
    // Along the northern sidewalk of the NW block: clear.
    expect(w.isSightBlocked(-104, 1.5, -102, -12, 1.5, -102)).toBe(false);
    // From that sidewalk into the plaza through the HOTEL ORBIT tower: blocked.
    expect(w.isSightBlocked(-89, 1.5, -104, -89, 1.5, -60)).toBe(true);
    expect(w.isSightBlocked(-104, 1.5, -85, -60, 1.5, -105)).toBe(true);
    // Straight down an avenue is clear.
    expect(w.isSightBlocked(0, 1.5, -100, 0, 1.5, 100)).toBe(false);
  });
});

describe('geom2d', () => {
  it('detects OBB overlaps and separates them', () => {
    const a = { cx: 0, cz: 0, yaw: 0, halfW: 1, halfL: 2 };
    const b = { cx: 1.5, cz: 0, yaw: Math.PI / 4, halfW: 1, halfL: 2 };
    const out = { x: 0, z: 0 };
    expect(obbVsObb(a, b, out)).toBe(true);
    expect(Math.hypot(out.x, out.z)).toBeGreaterThan(0);
    expect(obbVsObb(a, { ...b, cx: 10 }, out)).toBe(false);
    expect(obbVsAabb(a, 0.5, -5, 3, 5, out)).toBe(true);
    expect(out.x).toBeLessThan(0);
    expect(circleVsObb(0, -2.2, 0.3, a, out)).toBe(true);
    expect(out.z).toBeLessThan(0);
  });
});

describe('City layout', () => {
  const w = cityStatics();
  it('spawns, items and checkpoints are not inside buildings', () => {
    for (const s of Object.values(SPAWNS)) expect(w.isCircleBlocked(s.x, s.z, 0.3), s.id).toBe(false);
    for (const [id, p] of Object.entries(ITEM_SPAWNS)) expect(w.isPointInside(p.x, p.y, p.z), id).toBe(false);
    for (const c of CHECKPOINTS) expect(w.isCircleBlocked(c.x, c.z, 2), c.id).toBe(false);
    expect(w.isCircleBlocked(PLAYER_CAR_SPAWN.x, PLAYER_CAR_SPAWN.z, 1.5)).toBe(false);
  });

  it('pedestrian routes stay outside buildings', () => {
    for (const route of pedestrianRoutes()) {
      for (let i = 0; i < route.length; i++) {
        const a = route[i];
        const b = route[(i + 1) % route.length];
        for (let t = 0; t <= 1; t += 0.05) {
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          expect(w.isCircleBlocked(x, z, 0.25), `${x.toFixed(1)},${z.toFixed(1)}`).toBe(false);
        }
      }
    }
  });

  it('zones resolve', () => {
    const store = ZONES.find((z) => z.id === 'store_front')!;
    expect(isInZone(store, store.x, store.z)).toBe(true);
    expect(isInZone(store, 0, 0)).toBe(false);
  });
});

describe('RoadNetwork', () => {
  const roads = new RoadNetwork();
  it('has 9 junctions, 12 segments, 24 directed road lanes', () => {
    expect(roads.nodes.length).toBe(9);
    const edges = roads.nodes.reduce((n, x) => n + x.neighbors.length, 0) / 2;
    expect(edges).toBe(12);
    expect(roads.roadLanes.length).toBe(24);
    expect(roads.nodes.filter((n) => n.hasLight).length).toBe(5);
  });

  it('every road lane continues somewhere (no dead ends)', () => {
    for (const l of roads.roadLanes) {
      expect(l.next.length).toBeGreaterThan(0);
      for (const t of l.next) expect(t.next.length).toBe(1);
    }
  });

  it('lanes keep right-hand traffic', () => {
    const east = roads.roadLanes.find((l) => l.points[0].z > 0 && l.points[0].z < 6 && l.points[1].x > l.points[0].x);
    expect(east).toBeDefined();
    expect(east!.points[0].z).toBeCloseTo(3);
  });

  it('finds paths across the grid', () => {
    const a = roads.nodeAt(-110, -110);
    const b = roads.nodeAt(110, 110);
    const p = roads.findPath(a, b);
    expect(p[0]).toBe(a);
    expect(p[p.length - 1]).toBe(b);
    expect(p.length).toBe(5);
  });

  it('crossing directions never get green together', () => {
    const n = roads.nodeAt(0, 0);
    for (let t = 0; t < 60; t += 0.25) {
      const ns = roads.lightState(n, 'ns', t);
      const ew = roads.lightState(n, 'ew', t);
      expect(ns !== 'red' && ew !== 'red').toBe(false);
    }
  });

  it('nearest lane point snaps onto the road', () => {
    const p = roads.nearestLanePoint(30, 9);
    expect(roads.isOnRoad(p.pos.x, p.pos.z)).toBe(true);
    expect(p.dist).toBeLessThan(7);
  });
});
