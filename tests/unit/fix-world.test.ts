import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import type { CityBuilder } from '../../src/world/CityBuilder';
import { GARAGE, IMPOUND, PLAZA, STORE } from '../../src/world/CityLayout';
import { Landmarks, type LandmarkResult } from '../../src/world/Landmarks';
import { QuadBatch } from '../../src/world/MeshBatch';
import type { PropFactory } from '../../src/world/PropFactory';
import { StaticWorld } from '../../src/world/StaticWorld';

/** Minimal 2D canvas stand-in: the procedural textures only draw, never read back. */
function fakeCanvas(): object {
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return () => ({ width: 100 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop: () => undefined });
      return () => undefined;
    },
  });
  return { width: 0, height: 0, style: {}, getContext: () => ctx };
}

interface Built {
  world: StaticWorld;
  phys: CANNON.World;
  result: LandmarkResult;
  group: THREE.Group;
}

/** Builds the real Landmarks against a real StaticWorld + cannon world (props stubbed). */
function buildLandmarks(): Built {
  const world = new StaticWorld();
  const phys = new CANNON.World();
  const addBody = (shape: CANNON.Shape, x: number, y: number, z: number): CANNON.Body => {
    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, shape, position: new CANNON.Vec3(x, y, z) });
    phys.addBody(body);
    return body;
  };
  const physics = {
    addStaticBox: (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number) => addBody(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)), cx, cy, cz),
    addStaticCylinder: (cx: number, cy: number, cz: number, r: number, h: number) => addBody(new CANNON.Cylinder(r, r, h, 8), cx, cy, cz),
  } as unknown as PhysicsWorld;
  const city = {
    solid(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, opts: { sight?: boolean; walk?: boolean; cars?: boolean; tag?: string; physics?: boolean } = {}) {
      world.add(minX, minY, minZ, maxX, maxY, maxZ, { blocksSight: opts.sight, blocksWalk: opts.walk ?? true, blocksCars: opts.cars ?? true, tag: opts.tag });
      if (opts.physics !== false) physics.addStaticBox((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2, (maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2);
    },
  } as unknown as CityBuilder;
  const props = new Proxy({}, { get: () => () => undefined }) as PropFactory;
  const lm = new Landmarks(city, world, physics, props);
  const result = lm.build();
  lm.group.updateMatrixWorld(true);
  return { world, phys, result, group: lm.group };
}

function isUnder(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}

/** First opaque landmark surface hit along a ray (optionally ignoring a subtree). */
function firstOpaqueHit(group: THREE.Group, origin: THREE.Vector3, dir: THREE.Vector3, ignore?: THREE.Object3D): THREE.Intersection | null {
  const rc = new THREE.Raycaster(origin, dir.normalize(), 0, 60);
  for (const h of rc.intersectObject(group, true)) {
    const mat = (h.object as THREE.Mesh).material as THREE.Material;
    if (!mat || mat.transparent) continue;
    if (ignore && isUnder(h.object, ignore)) continue;
    return h;
  }
  return null;
}

describe('world fixes', () => {
  let b: Built;
  beforeAll(() => {
    vi.stubGlobal('document', { createElement: () => fakeCanvas() });
    b = buildLandmarks();
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('C25: NEON 24 shell has a real doorway (outside and inside) and the door sits in it', () => {
    const doorX = (STORE.doorX0 + STORE.doorX1) / 2;
    const pivot = b.result.storeDoor.pivot;
    // Ignoring the door itself, a ray through the doorway reaches deep inside (cooler), from outside...
    const fromOut = firstOpaqueHit(b.group, new THREE.Vector3(doorX, 1.2, STORE.maxZ + 8), new THREE.Vector3(0, 0, -1), pivot);
    expect(fromOut).not.toBeNull();
    expect(fromOut!.point.z).toBeLessThan(STORE.maxZ - 1);
    // ...and from inside the interior wall face does not cover the doorway.
    const fromIn = firstOpaqueHit(b.group, new THREE.Vector3(doorX, 1.2, STORE.maxZ - 7), new THREE.Vector3(0, 0, 1), pivot);
    if (fromIn) expect(fromIn.point.z).toBeGreaterThan(STORE.maxZ + 0.05);
    // The closed glass door is the first thing seen in the opening (inside the wall thickness).
    const door = firstOpaqueHit(b.group, new THREE.Vector3(doorX, 1.2, STORE.maxZ + 8), new THREE.Vector3(0, 0, -1));
    expect(door).not.toBeNull();
    expect(isUnder(door!.object, pivot)).toBe(true);
    expect(door!.point.z).toBeGreaterThan(STORE.maxZ - 0.3);
    expect(door!.point.z).toBeLessThan(STORE.maxZ);
    // Wall beside the door and the lintel above it are still there.
    expect(firstOpaqueHit(b.group, new THREE.Vector3(STORE.minX + 3, 3, STORE.maxZ + 8), new THREE.Vector3(0, 0, -1))!.point.z).toBeCloseTo(STORE.maxZ, 3);
    expect(firstOpaqueHit(b.group, new THREE.Vector3(doorX, 2.5, STORE.maxZ + 8), new THREE.Vector3(0, 0, -1))!.point.z).toBeCloseTo(STORE.maxZ, 3);
  });

  it('C25: safehouse garage shell is open where the roll-up door is', () => {
    const doorZ = (GARAGE.doorZ0 + GARAGE.doorZ1) / 2;
    b.result.garageDoor.setOpen(true, true);
    b.result.garageDoor.update(0);
    b.group.updateMatrixWorld(true);
    const fromOut = firstOpaqueHit(b.group, new THREE.Vector3(GARAGE.maxX + 7, 1.5, doorZ), new THREE.Vector3(-1, 0, 0));
    expect(fromOut).not.toBeNull();
    expect(fromOut!.point.x).toBeLessThan(GARAGE.maxX - 1);
    const fromIn = firstOpaqueHit(b.group, new THREE.Vector3(GARAGE.maxX - 8, 1.5, doorZ), new THREE.Vector3(1, 0, 0));
    if (fromIn) expect(fromIn.point.x).toBeGreaterThan(GARAGE.maxX + 0.05);
    // Closed: the panel fills the opening inside the wall thickness; the wall beside it is intact.
    b.result.garageDoor.setOpen(false, true);
    b.result.garageDoor.update(0);
    b.group.updateMatrixWorld(true);
    const panel = firstOpaqueHit(b.group, new THREE.Vector3(GARAGE.maxX + 7, 1.5, doorZ), new THREE.Vector3(-1, 0, 0))!;
    expect(panel.point.x).toBeGreaterThan(GARAGE.maxX - 0.3);
    expect(panel.point.x).toBeLessThan(GARAGE.maxX);
    expect(firstOpaqueHit(b.group, new THREE.Vector3(GARAGE.maxX + 7, 1.5, GARAGE.doorZ0 - 2), new THREE.Vector3(-1, 0, 0))!.point.x).toBeCloseTo(GARAGE.maxX, 3);
  });

  it('C27: fountain basin collider follows the round rim for walking and physics', () => {
    const fx = PLAZA.fountainX;
    const fz = PLAZA.fountainZ;
    const ray = new CANNON.RaycastResult();
    for (let deg = 0; deg < 360; deg += 7.5) {
      const a = (deg * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // Walking (body radius 0.28): stopped before the rim, free just outside it.
      expect(b.world.isCircleBlocked(fx + 3.95 * c, fz + 3.95 * s, 0.28), `walk in @${deg}`).toBe(true);
      expect(b.world.isCircleBlocked(fx + 4.62 * c, fz + 4.62 * s, 0.28), `walk out @${deg}`).toBe(false);
      // Physics: a ray toward the centre meets the basin near its 4.2 m edge.
      ray.reset();
      b.phys.raycastClosest(new CANNON.Vec3(fx + 6 * c, 0.35, fz + 6 * s), new CANNON.Vec3(fx, 0.35, fz), {}, ray);
      expect(ray.hasHit, `phys @${deg}`).toBe(true);
      const r = Math.hypot(ray.hitPointWorld.x - fx, ray.hitPointWorld.z - fz);
      expect(r, `phys r @${deg}`).toBeGreaterThan(3.98);
      expect(r, `phys r @${deg}`).toBeLessThan(4.35);
    }
  });

  it('C28: impound gate leaf and floodlight pole block movement', () => {
    expect(b.world.isCircleBlocked(IMPOUND.gateX0 - 0.1, IMPOUND.minZ - 2, 0.28)).toBe(true);
    expect(b.world.isCircleBlocked(IMPOUND.gateX0 - 0.1, IMPOUND.minZ - 3.8, 0.28)).toBe(true);
    expect(b.world.isCircleBlocked(IMPOUND.maxX - 1, IMPOUND.minZ + 1, 0.28)).toBe(true);
    // The gate opening itself stays clear.
    expect(b.world.isCircleBlocked((IMPOUND.gateX0 + IMPOUND.gateX1) / 2, IMPOUND.minZ, 0.28)).toBe(false);
  });
});

describe('QuadBatch openings', () => {
  it('skips one face and rebuilds it around an opening with outward normals', () => {
    const q = new QuadBatch();
    const col = new THREE.Color('#ffffff');
    q.walls(0, 0, 10, 10, 0, 4, 4, 4, col, 's');
    q.wallWithOpening('x', 10, 0, 10, 0, 4, 4, 6, 2.5, 1, 4, col);
    q.doorReveal('x', 9.7, 10, 4, 6, 0, 2.5, 4, col);
    const mesh = new THREE.Mesh(q.build(), new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    // 3 walls + 3 opening pieces + 2 jambs + soffit.
    expect(mesh.geometry.getIndex()!.count).toBe(9 * 6);
    const rc = new THREE.Raycaster(new THREE.Vector3(5, 1, 20), new THREE.Vector3(0, 0, -1));
    expect(rc.intersectObject(mesh)).toHaveLength(0); // through the doorway (far wall seen from behind is culled)
    rc.set(new THREE.Vector3(2, 1, 20), new THREE.Vector3(0, 0, -1));
    const side = rc.intersectObject(mesh)[0];
    expect(side.point.z).toBeCloseTo(10, 5);
    expect(side.face!.normal.z).toBeCloseTo(1, 5);
    rc.set(new THREE.Vector3(5, 3, 20), new THREE.Vector3(0, 0, -1));
    expect(rc.intersectObject(mesh)[0].point.z).toBeCloseTo(10, 5); // lintel
    // Jambs face into the opening, the soffit faces down.
    rc.set(new THREE.Vector3(5, 1, 9.85), new THREE.Vector3(-1, 0, 0));
    expect(rc.intersectObject(mesh)[0].point.x).toBeCloseTo(4, 5);
    rc.set(new THREE.Vector3(5, 1, 9.85), new THREE.Vector3(1, 0, 0));
    expect(rc.intersectObject(mesh)[0].point.x).toBeCloseTo(6, 5);
    rc.set(new THREE.Vector3(5, 1, 9.85), new THREE.Vector3(0, 1, 0));
    expect(rc.intersectObject(mesh)[0].point.y).toBeCloseTo(2.5, 5);
  });
});
