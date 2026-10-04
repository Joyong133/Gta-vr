import * as THREE from 'three';
import { makeRng, randRange } from '../core/math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { BLOCKS, BUILDINGS, CITY, type BuildingDef } from './CityLayout';
import { PrimitiveBatch, QuadBatch } from './MeshBatch';
import { NeonSign } from './NeonSign';
import type { RoadNetwork } from './RoadNetwork';
import type { StaticWorld } from './StaticWorld';
import {
  makeAsphaltTexture,
  makeFacadeTextures,
  makeSidewalkTexture,
  makeStorefrontTexture,
} from './Textures';

const BUILDING_COLORS = ['#8d7f99', '#7a8aa0', '#a08a7a', '#6f7d8a', '#9a8f86', '#857a8f', '#6c6f80', '#8a7468'];

/**
 * Builds the static city: ground, roads + markings, sidewalks, buildings
 * (merged into a few draw calls), boundary towers and neon signs.
 * Registers every solid box in StaticWorld (gameplay queries) and in the
 * physics world (vehicle / prop collisions).
 */
export class CityBuilder {
  readonly group = new THREE.Group();
  readonly signs: NeonSign[] = [];
  private readonly rng = makeRng(1337);

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly world: StaticWorld,
    private readonly roads: RoadNetwork,
  ) {
    this.group.name = 'City';
  }

  build(): void {
    this.buildGround();
    this.buildRoads();
    this.buildBuildings();
    this.buildBoundary();
  }

  /** Registers a solid box for both gameplay queries and physics. */
  solid(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, opts: { sight?: boolean; walk?: boolean; cars?: boolean; tag?: string; physics?: boolean } = {}): void {
    this.world.add(minX, minY, minZ, maxX, maxY, maxZ, {
      blocksSight: opts.sight,
      blocksWalk: opts.walk ?? true,
      blocksCars: opts.cars ?? true,
      tag: opts.tag,
    });
    if (opts.physics !== false) {
      this.physics.addStaticBox((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2, (maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2);
    }
  }

  private buildGround(): void {
    const lot = new QuadBatch();
    lot.floor(-160, -160, 160, 160, 0, 6, new THREE.Color('#5d5a63'));
    const lotTex = makeSidewalkTexture();
    const lotMesh = new THREE.Mesh(lot.build(), new THREE.MeshLambertMaterial({ map: lotTex, vertexColors: true }));
    lotMesh.receiveShadow = true;
    lotMesh.name = 'GroundLots';
    this.group.add(lotMesh);

    const walk = new QuadBatch();
    const swColor = new THREE.Color('#b9b6c4');
    for (const b of Object.values(BLOCKS)) walk.floor(b.minX - 4, b.minZ - 4, b.maxX + 4, b.maxZ + 4, 0.02, 3, swColor);
    // Outer ring sidewalks beyond the perimeter roads.
    walk.floor(-120, -120, 120, -116, 0.02, 3, swColor);
    walk.floor(-120, 116, 120, 120, 0.02, 3, swColor);
    walk.floor(-120, -116, -116, 116, 0.02, 3, swColor);
    walk.floor(116, -116, 120, 116, 0.02, 3, swColor);
    const swMesh = new THREE.Mesh(walk.build(), new THREE.MeshLambertMaterial({ map: makeSidewalkTexture(), vertexColors: true }));
    swMesh.receiveShadow = true;
    swMesh.name = 'Sidewalks';
    this.group.add(swMesh);

    // Curbs (visual only; physics ground stays flat for comfortable, predictable driving).
    const curbs = new PrimitiveBatch();
    const curbCol = '#8f8b97';
    for (const b of Object.values(BLOCKS)) {
      const x0 = b.minX - 4;
      const x1 = b.maxX + 4;
      const z0 = b.minZ - 4;
      const z1 = b.maxZ + 4;
      curbs.box((x0 + x1) / 2, 0.05, z0, x1 - x0, 0.1, 0.25, curbCol);
      curbs.box((x0 + x1) / 2, 0.05, z1, x1 - x0, 0.1, 0.25, curbCol);
      curbs.box(x0, 0.05, (z0 + z1) / 2, 0.25, 0.1, z1 - z0, curbCol);
      curbs.box(x1, 0.05, (z0 + z1) / 2, 0.25, 0.1, z1 - z0, curbCol);
    }
    for (const s of [-1, 1]) {
      curbs.box(0, 0.05, s * 116, 232, 0.1, 0.25, curbCol);
      curbs.box(s * 116, 0.05, 0, 0.25, 0.1, 232, curbCol);
    }
    const curbMesh = new THREE.Mesh(curbs.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    curbMesh.receiveShadow = true;
    this.group.add(curbMesh);
  }

  private buildRoads(): void {
    const asphalt = new QuadBatch();
    const hw = CITY.roadHalfWidth;
    const ext = 116;
    const col = new THREE.Color('#ffffff');
    for (const l of CITY.roadLines) {
      asphalt.floor(-ext, l - hw, ext, l + hw, 0.01, 8, col);
      asphalt.floor(l - hw, -ext, l + hw, ext, 0.011, 8, col);
    }
    const roadMesh = new THREE.Mesh(asphalt.build(), new THREE.MeshLambertMaterial({ map: makeAsphaltTexture(), vertexColors: true }));
    roadMesh.receiveShadow = true;
    roadMesh.name = 'Roads';
    this.group.add(roadMesh);

    // Markings: centre double-yellow, edge lines, crosswalks, stop lines.
    const marks = new PrimitiveBatch();
    const yellow = '#e8b923';
    const white = '#e9ecf2';
    const jh = this.roads.junctionHalf;
    const flat = new THREE.PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);
    const strip = (x0: number, z0: number, x1: number, z1: number, color: string): void => {
      const g = flat.clone();
      g.scale(Math.max(0.01, x1 - x0), 1, Math.max(0.01, z1 - z0));
      marks.add(g, (x0 + x1) / 2, 0.022, (z0 + z1) / 2, color);
    };
    for (const n of this.roads.nodes) {
      for (const bi of n.neighbors) {
        const b = this.roads.nodes[bi];
        if (bi < n.id) continue; // each segment once
        if (b.z === n.z) {
          const x0 = Math.min(n.x, b.x) + jh + 3;
          const x1 = Math.max(n.x, b.x) - jh - 3;
          strip(x0, n.z - 0.22, x1, n.z - 0.1, yellow);
          strip(x0, n.z + 0.1, x1, n.z + 0.22, yellow);
          strip(x0, n.z - hw + 0.35, x1, n.z - hw + 0.5, white);
          strip(x0, n.z + hw - 0.5, x1, n.z + hw - 0.35, white);
        } else {
          const z0 = Math.min(n.z, b.z) + jh + 3;
          const z1 = Math.max(n.z, b.z) - jh - 3;
          strip(n.x - 0.22, z0, n.x - 0.1, z1, yellow);
          strip(n.x + 0.1, z0, n.x + 0.22, z1, yellow);
          strip(n.x - hw + 0.35, z0, n.x - hw + 0.5, z1, white);
          strip(n.x + hw - 0.5, z0, n.x + hw - 0.35, z1, white);
        }
      }
      // Crosswalk + stop line on each approach.
      for (const bi of n.neighbors) {
        const b = this.roads.nodes[bi];
        const dx = Math.sign(b.x - n.x);
        const dz = Math.sign(b.z - n.z);
        const near = jh + 0.4;
        const far = jh + 3;
        for (let k = -hw + 0.6; k < hw - 0.4; k += 1.1) {
          if (dx !== 0) {
            const xa = n.x + dx * near;
            const xb = n.x + dx * far;
            strip(Math.min(xa, xb), n.z + k, Math.max(xa, xb), n.z + k + 0.55, white);
          } else {
            const za = n.z + dz * near;
            const zb = n.z + dz * far;
            strip(n.x + k, Math.min(za, zb), n.x + k + 0.55, Math.max(za, zb), white);
          }
        }
        // Stop line across the lane that arrives at this node. Arriving traffic travels
        // (-dx, -dz); its right-hand lane is offset by (dz, -dx) * laneOffset.
        const sl = far + 0.4;
        const xa = n.x + dx * sl;
        const xb = n.x + dx * (sl + 0.45);
        const za = n.z + dz * sl;
        const zb = n.z + dz * (sl + 0.45);
        if (dx !== 0) {
          const zMin = dx > 0 ? n.z - hw + 0.3 : n.z;
          const zMax = dx > 0 ? n.z : n.z + hw - 0.3;
          strip(Math.min(xa, xb), zMin, Math.max(xa, xb), zMax, white);
        } else {
          const xMin = dz > 0 ? n.x : n.x - hw + 0.3;
          const xMax = dz > 0 ? n.x + hw - 0.3 : n.x;
          strip(xMin, Math.min(za, zb), xMax, Math.max(za, zb), white);
        }
      }
    }
    const markMesh = new THREE.Mesh(marks.build(), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x111111 }));
    markMesh.receiveShadow = true;
    markMesh.name = 'RoadMarkings';
    this.group.add(markMesh);
  }

  private buildBuildings(): void {
    const variants = [makeFacadeTextures(101, 0.75), makeFacadeTextures(202, 0.4), makeFacadeTextures(303, 0.6)];
    const facades = variants.map(() => new QuadBatch());
    const roofs = new QuadBatch();
    const shopfronts = new QuadBatch();
    const roofDetails = new PrimitiveBatch();
    const all: BuildingDef[] = [...BUILDINGS];
    all.forEach((b, i) => this.addBuilding(b, i, facades[i % facades.length], roofs, shopfronts, roofDetails));

    variants.forEach((v, i) => {
      if (facades[i].empty) return;
      const mat = new THREE.MeshLambertMaterial({
        map: v.map,
        emissiveMap: v.emissive,
        emissive: new THREE.Color(1, 1, 1),
        emissiveIntensity: 1.25,
        vertexColors: true,
      });
      const mesh = new THREE.Mesh(facades[i].build(), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `Facades${i}`;
      this.group.add(mesh);
    });
    const roofMesh = new THREE.Mesh(roofs.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    roofMesh.name = 'Roofs';
    this.group.add(roofMesh);
    if (!shopfronts.empty) {
      const sfTex = makeStorefrontTexture();
      const sf = new THREE.Mesh(shopfronts.build(), new THREE.MeshBasicMaterial({ map: sfTex, vertexColors: true, toneMapped: false }));
      sf.name = 'Shopfronts';
      this.group.add(sf);
    }
    if (!roofDetails.empty) {
      const rd = new THREE.Mesh(roofDetails.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
      rd.castShadow = true;
      rd.name = 'RoofDetails';
      this.group.add(rd);
    }
  }

  private addBuilding(b: BuildingDef, i: number, facade: QuadBatch, roofs: QuadBatch, shopfronts: QuadBatch, details: PrimitiveBatch): void {
    const color = new THREE.Color(BUILDING_COLORS[i % BUILDING_COLORS.length]);
    const groundFloor = b.style === 'shop' || b.style === 'low' ? 4 : 0;
    facade.walls(b.minX, b.minZ, b.maxX, b.maxZ, groundFloor, b.height, 8, 14, color);
    if (groundFloor > 0) {
      // Lit storefront band around the ground floor.
      const o = 0.04;
      const sfCol = new THREE.Color(b.style === 'shop' ? '#ffffff' : '#b8a6c8');
      shopfronts.walls(b.minX - o, b.minZ - o, b.maxX + o, b.maxZ + o, 0, groundFloor, 4, groundFloor, sfCol);
    }
    roofs.floor(b.minX, b.minZ, b.maxX, b.maxZ, b.height, 4, new THREE.Color('#2b2a33'));
    // Parapet + rooftop units for a less boxy skyline.
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const pc = '#3a3742';
    details.box(cx, b.height + 0.4, b.minZ + 0.2, w, 0.8, 0.4, pc);
    details.box(cx, b.height + 0.4, b.maxZ - 0.2, w, 0.8, 0.4, pc);
    details.box(b.minX + 0.2, b.height + 0.4, cz, 0.4, 0.8, d, pc);
    details.box(b.maxX - 0.2, b.height + 0.4, cz, 0.4, 0.8, d, pc);
    const units = 1 + Math.floor(this.rng() * 3);
    for (let k = 0; k < units; k++) {
      const ux = randRange(this.rng, b.minX + 3, b.maxX - 3);
      const uz = randRange(this.rng, b.minZ + 3, b.maxZ - 3);
      details.box(ux, b.height + 1, uz, 2.5, 2, 2, '#55525e');
    }
    if (b.style === 'tower' && this.rng() < 0.8) {
      details.cylinder(cx, b.height + 3, cz, 1.6, 4, '#4a4552', 10);
    }
    // Ground-floor door slabs for flavour (not enterable).
    details.box(cx, 1.2, b.maxZ + 0.06, 1.6, 2.4, 0.12, '#1d1a22');

    this.solid(b.minX, 0, b.minZ, b.maxX, b.height, b.maxZ, { sight: true, tag: 'building' });
    if (b.sign) this.addSign(b);
  }

  private addSign(b: BuildingDef): void {
    const s = b.sign!;
    const sign = new NeonSign(s.text, s.color, s.width, { sub: s.sub, color2: s.color2, vertical: s.vertical, flicker: s.flicker });
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const off = 0.2;
    switch (s.face) {
      case 's':
        sign.group.position.set(s.vertical ? b.maxX - 2 : cx, s.y, b.maxZ + off);
        break;
      case 'n':
        sign.group.position.set(s.vertical ? b.minX + 2 : cx, s.y, b.minZ - off);
        sign.group.rotation.y = Math.PI;
        break;
      case 'e':
        sign.group.position.set(b.maxX + off, s.y, s.vertical ? b.maxZ - 2 : cz);
        sign.group.rotation.y = Math.PI / 2;
        break;
      case 'w':
        sign.group.position.set(b.minX - off, s.y, s.vertical ? b.minZ + 2 : cz);
        sign.group.rotation.y = -Math.PI / 2;
        break;
    }
    this.group.add(sign.group);
    this.signs.push(sign);
  }

  /** Towers outside the perimeter road + invisible walls at the district edge. */
  private buildBoundary(): void {
    const defs: BuildingDef[] = [];
    const inner = 121;
    const outer = 148;
    const rng = this.rng;
    const run = (along: 'x' | 'z', side: number, from: number, to: number): void => {
      let p = from;
      while (p < to - 4) {
        const w = Math.min(to - p, randRange(rng, 18, 32));
        const h = randRange(rng, 22, 58);
        const depth = randRange(rng, 16, outer - inner);
        if (along === 'x') {
          const z0 = side < 0 ? -inner - depth : inner;
          const z1 = side < 0 ? -inner : inner + depth;
          defs.push({ minX: p, maxX: p + w - 1, minZ: z0, maxZ: z1, height: h, style: h > 40 ? 'tower' : 'mid' });
        } else {
          const x0 = side < 0 ? -inner - depth : inner;
          const x1 = side < 0 ? -inner : inner + depth;
          defs.push({ minX: x0, maxX: x1, minZ: p, maxZ: p + w - 1, height: h, style: h > 40 ? 'tower' : 'mid' });
        }
        p += w;
      }
    };
    run('x', -1, -150, 150);
    run('x', 1, -150, 150);
    run('z', -1, -inner, inner);
    run('z', 1, -inner, inner);
    const variants = [makeFacadeTextures(404, 0.7), makeFacadeTextures(505, 0.5)];
    const batches = variants.map(() => new QuadBatch());
    const roofs = new QuadBatch();
    const shop = new QuadBatch();
    const details = new PrimitiveBatch();
    defs.forEach((d, i) => this.addBuilding(d, i + 3, batches[i % 2], roofs, shop, details));
    batches.forEach((bq, i) => {
      const mat = new THREE.MeshLambertMaterial({ map: variants[i].map, emissiveMap: variants[i].emissive, emissive: 0xffffff, emissiveIntensity: 1.1, vertexColors: true });
      const m = new THREE.Mesh(bq.build(), mat);
      m.name = `Boundary${i}`;
      this.group.add(m);
    });
    this.group.add(new THREE.Mesh(roofs.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
    this.group.add(new THREE.Mesh(details.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
    // Invisible walls (no rendering): keep the car inside the slice.
    const b = CITY.boundary;
    this.solid(-160, 0, -160, 160, 12, -b, { sight: true, tag: 'edge' });
    this.solid(-160, 0, b, 160, 12, 160, { sight: true, tag: 'edge' });
    this.solid(-160, 0, -b, -b, 12, b, { sight: true, tag: 'edge' });
    this.solid(b, 0, -b, 160, 12, b, { sight: true, tag: 'edge' });
  }
}
