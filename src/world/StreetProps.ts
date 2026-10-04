import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from '../core/math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { CITY, PLAZA } from './CityLayout';
import type { Axis, RoadNetwork } from './RoadNetwork';
import type { StaticWorld } from './StaticWorld';
import { makeGlowTexture } from './Textures';

/** Areas kept free of street furniture (driveways, drop boxes, store fronts). */
const KEEP_CLEAR: [number, number, number, number][] = [
  [-28, -12, -12, -4], // plaza car exit
  [-12, 17, -5, 29], // garage driveway
  [10, -12, 42, -5], // gas station entrances
  [44, -13, 58, -5], // store front
  [42, 99, 72, 107], // police parking exit
  [-105, 57, -99, 67], // KAI RAMEN drop box
  [52, 54, 62, 58], // impound gate
];

function clear(x: number, z: number): boolean {
  for (const [x0, z0, x1, z1] of KEEP_CLEAR) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return false;
  return true;
}

interface LightHead {
  axis: Axis;
  node: number;
  red: THREE.MeshBasicMaterial;
  yellow: THREE.MeshBasicMaterial;
  green: THREE.MeshBasicMaterial;
}

/**
 * Instanced street furniture: lamps (+ fake light pools), trees, benches,
 * hydrants and working traffic lights.
 */
export class StreetProps {
  readonly group = new THREE.Group();
  private readonly heads: LightHead[] = [];
  readonly lampPositions: THREE.Vector3[] = [];
  private readonly rng = makeRng(99);

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly world: StaticWorld,
    private readonly roads: RoadNetwork,
  ) {
    this.group.name = 'StreetProps';
  }

  build(): void {
    const lamps: { x: number; z: number; rot: number }[] = [];
    const trees: { x: number; z: number }[] = [];
    const benches: { x: number; z: number; rot: number }[] = [];
    const hydrants: { x: number; z: number }[] = [];
    const hw = CITY.roadHalfWidth;
    for (const n of this.roads.nodes) {
      for (const bi of n.neighbors) {
        if (bi < n.id) continue;
        const b = this.roads.nodes[bi];
        const alongX = b.z === n.z;
        const from = alongX ? Math.min(n.x, b.x) : Math.min(n.z, b.z);
        const to = alongX ? Math.max(n.x, b.x) : Math.max(n.z, b.z);
        for (let p = from + 14; p <= to - 14; p += 24) {
          for (const side of [-1, 1]) {
            const off = side * (hw + 0.8);
            const lx = alongX ? p : n.x + off;
            const lz = alongX ? n.z + off : p;
            if (clear(lx, lz)) {
              // arm points toward the road: rotation so local -X points at road
              lamps.push({ x: lx, z: lz, rot: alongX ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : side > 0 ? 0 : Math.PI });
            }
            const toff = side * (hw + 3.2);
            const tx = alongX ? p + 12 : n.x + toff;
            const tz = alongX ? n.z + toff : p + 12;
            if (p + 12 <= to - 12 && clear(tx, tz) && this.rng() < 0.55) {
              trees.push({ x: tx, z: tz });
            } else if (p + 12 <= to - 12 && clear(tx, tz) && this.rng() < 0.4) {
              benches.push({ x: tx, z: tz, rot: alongX ? (side > 0 ? Math.PI : 0) : side > 0 ? Math.PI / 2 : -Math.PI / 2 });
            }
            if (this.rng() < 0.18) {
              const hx = alongX ? p + 5 : n.x + side * (hw + 1.2);
              const hz = alongX ? n.z + side * (hw + 1.2) : p + 5;
              if (clear(hx, hz)) hydrants.push({ x: hx, z: hz });
            }
          }
        }
      }
    }
    // Plaza dressing.
    const pcx = PLAZA.fountainX;
    const pcz = PLAZA.fountainZ;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      trees.push({ x: pcx + Math.cos(a) * 17, z: pcz + Math.sin(a) * 17 });
      benches.push({ x: pcx + Math.cos(a + 0.4) * 11, z: pcz + Math.sin(a + 0.4) * 11, rot: -a - Math.PI / 2 + 0.4 });
    }
    for (const [x, z] of [
      [-70, -24],
      [-60, -24],
      [-40, -60],
      [-72, -58],
    ]) lamps.push({ x, z, rot: 0 });

    this.buildLamps(lamps);
    this.buildTrees(trees);
    this.buildBenches(benches);
    this.buildHydrants(hydrants);
    this.buildTrafficLights();
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: { x: number; y?: number; z: number; rot?: number; s?: number }[], shadow = false): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    items.forEach((it, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot ?? 0);
      const sc = it.s ?? 1;
      m.compose(p.set(it.x, it.y ?? 0, it.z), q, s.set(sc, sc, sc));
      mesh.setMatrixAt(i, m);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = shadow;
    mesh.receiveShadow = false;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    return mesh;
  }

  private buildLamps(lamps: { x: number; z: number; rot: number }[]): void {
    const pole = new THREE.CylinderGeometry(0.08, 0.11, 6, 8);
    pole.translate(0, 3, 0);
    const arm = new THREE.BoxGeometry(1.6, 0.1, 0.12);
    arm.translate(-0.75, 5.9, 0);
    const poleGeo = mergeGeometries([pole, arm]);
    const head = new THREE.BoxGeometry(0.55, 0.14, 0.3);
    head.translate(-1.45, 5.8, 0);
    this.instanced(poleGeo ?? pole, new THREE.MeshLambertMaterial({ color: 0x2c2e38 }), lamps, true);
    this.instanced(head, new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }), lamps);
    // Fake light pools: additive glow decals on the ground, no real lights.
    const pool = new THREE.PlaneGeometry(8, 8);
    pool.rotateX(-Math.PI / 2);
    pool.translate(-1.45, 0.035, 0);
    const poolMat = new THREE.MeshBasicMaterial({
      map: makeGlowTexture(),
      color: 0xffb066,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.instanced(pool, poolMat, lamps).renderOrder = 2;
    for (const l of lamps) {
      this.world.addCentered(l.x, 3, l.z, 0.3, 6, 0.3, { blocksSight: false, tag: 'lamp' });
      this.physics.addStaticCylinder(l.x, 1.5, l.z, 0.12, 3);
      this.lampPositions.push(new THREE.Vector3(l.x, 5.8, l.z));
    }
  }

  private buildTrees(trees: { x: number; z: number }[]): void {
    const trunk = new THREE.CylinderGeometry(0.14, 0.2, 2.8, 7);
    trunk.translate(0, 1.4, 0);
    const items = trees.map((t) => ({ ...t, rot: this.rng() * 6, s: 0.85 + this.rng() * 0.35 }));
    this.instanced(trunk, new THREE.MeshLambertMaterial({ color: 0x3b2a22 }), items, true);
    const crown = new THREE.IcosahedronGeometry(1.7, 1);
    crown.translate(0, 3.9, 0);
    this.instanced(crown, new THREE.MeshLambertMaterial({ color: 0x1f4a32, emissive: 0x06120b, flatShading: true }), items, true);
    // Tree pits
    const pit = new THREE.BoxGeometry(1.4, 0.06, 1.4);
    this.instanced(pit, new THREE.MeshLambertMaterial({ color: 0x2a2018 }), items);
    for (const t of trees) {
      this.world.addCentered(t.x, 1.4, t.z, 0.4, 2.8, 0.4, { blocksSight: false, tag: 'tree' });
      this.physics.addStaticCylinder(t.x, 1.4, t.z, 0.2, 2.8);
    }
  }

  private buildBenches(benches: { x: number; z: number; rot: number }[]): void {
    const seat = new THREE.BoxGeometry(1.8, 0.08, 0.5);
    seat.translate(0, 0.45, 0);
    const back = new THREE.BoxGeometry(1.8, 0.45, 0.06);
    back.translate(0, 0.75, 0.24);
    const legL = new THREE.BoxGeometry(0.08, 0.45, 0.45);
    legL.translate(-0.8, 0.22, 0);
    const legR = legL.clone();
    legR.translate(1.6, 0, 0);
    const geo = mergeGeometries([seat, back, legL, legR]);
    if (geo) this.instanced(geo, new THREE.MeshLambertMaterial({ color: 0x6a4b3a }), benches, true);
    for (const b of benches) {
      const c = Math.abs(Math.cos(b.rot));
      const sx = c > 0.7 ? 1.8 : 0.6;
      const sz = c > 0.7 ? 0.6 : 1.8;
      this.world.addCentered(b.x, 0.5, b.z, sx, 1.0, sz, { blocksSight: false, blocksCars: false, tag: 'bench' });
      this.physics.addStaticBox(b.x, 0.45, b.z, sx / 2, 0.45, sz / 2);
    }
  }

  private buildHydrants(h: { x: number; z: number }[]): void {
    const body = new THREE.CylinderGeometry(0.13, 0.16, 0.7, 8);
    body.translate(0, 0.35, 0);
    const cap = new THREE.SphereGeometry(0.14, 8, 6);
    cap.translate(0, 0.72, 0);
    const geo = mergeGeometries([body, cap]);
    if (geo) this.instanced(geo, new THREE.MeshLambertMaterial({ color: 0xc92b2b, emissive: 0x220000 }), h);
    for (const p of h) {
      this.world.addCentered(p.x, 0.4, p.z, 0.35, 0.8, 0.35, { blocksSight: false, tag: 'hydrant' });
      this.physics.addStaticCylinder(p.x, 0.4, p.z, 0.16, 0.8);
    }
  }

  private buildTrafficLights(): void {
    const jh = this.roads.junctionHalf;
    const hw = CITY.roadHalfWidth;
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x23252e });
    const housingMat = new THREE.MeshLambertMaterial({ color: 0x111218 });
    const lampGeo = new THREE.CircleGeometry(0.1, 12);
    const mats = new Map<string, LightHead>();
    for (const n of this.roads.nodes) {
      if (!n.hasLight) continue;
      for (const bi of n.neighbors) {
        const b = this.roads.nodes[bi];
        // Traffic arriving from b travels t = (n - b) normalised.
        const tx = Math.sign(n.x - b.x);
        const tz = Math.sign(n.z - b.z);
        const rx = -tz;
        const rz = tx;
        const px = n.x + tx * (jh + 1.2) + rx * (hw + 1.2);
        const pz = n.z + tz * (jh + 1.2) + rz * (hw + 1.2);
        const axis: Axis = tx !== 0 ? 'ew' : 'ns';
        const key = `${n.id}:${axis}`;
        let head = mats.get(key);
        if (!head) {
          head = {
            axis,
            node: n.id,
            red: new THREE.MeshBasicMaterial({ color: 0x330000, toneMapped: false }),
            yellow: new THREE.MeshBasicMaterial({ color: 0x332200, toneMapped: false }),
            green: new THREE.MeshBasicMaterial({ color: 0x002200, toneMapped: false }),
          };
          mats.set(key, head);
          this.heads.push(head);
        }
        const g = new THREE.Group();
        g.position.set(px, 0, pz);
        // Face the arriving traffic: front (+Z) = -t
        g.rotation.y = Math.atan2(-tx, -tz);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 8), poleMat);
        pole.position.y = 2.1;
        const housing = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.05, 0.26), housingMat);
        housing.position.set(0, 4.0, 0.05);
        g.add(pole, housing);
        const lamps: [THREE.MeshBasicMaterial, number][] = [
          [head.red, 4.33],
          [head.yellow, 4.0],
          [head.green, 3.67],
        ];
        for (const [mat, y] of lamps) {
          const l = new THREE.Mesh(lampGeo, mat);
          l.position.set(0, y, 0.185);
          g.add(l);
        }
        this.group.add(g);
        this.world.addCentered(px, 2.1, pz, 0.3, 4.2, 0.3, { blocksSight: false, tag: 'signal' });
        this.physics.addStaticCylinder(px, 1.5, pz, 0.1, 3);
      }
    }
  }

  /** Updates traffic light lamps from the shared light schedule. */
  updateLights(time: number): void {
    for (const h of this.heads) {
      const s = this.roads.lightState(h.node, h.axis, time);
      h.red.color.setHex(s === 'red' ? 0xff2a2a : 0x2a0505);
      h.yellow.color.setHex(s === 'yellow' ? 0xffc21a : 0x2a1d05);
      h.green.color.setHex(s === 'green' ? 0x2aff7a : 0x052a12);
    }
  }
}
