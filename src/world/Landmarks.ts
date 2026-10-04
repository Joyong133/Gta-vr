import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { Door } from '../interaction/Door';
import { PushButton } from '../interaction/PushButton';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { CityBuilder } from './CityBuilder';
import { GARAGE, GAS, IMPOUND, PLAZA, SOCKETS, STORE, MISSION_GIVER } from './CityLayout';
import { PrimitiveBatch, QuadBatch } from './MeshBatch';
import { NeonSign } from './NeonSign';
import type { PropFactory } from './PropFactory';
import type { StaticBox, StaticWorld } from './StaticWorld';
import { makeGlowTexture, makeLabelTexture, makePlazaTexture, makeTileFloorTexture } from './Textures';

/** Roll-up garage door driven by push buttons; updates its colliders as it opens. */
export class GarageDoor {
  amount = 0; // 0 closed .. 1 open
  open = false;
  private readonly panel: THREE.Mesh;
  private readonly box: StaticBox;
  private readonly body: CANNON.Body;
  onMove?: (opening: boolean) => void;

  constructor(group: THREE.Group, world: StaticWorld, physics: PhysicsWorld) {
    const h = GARAGE.doorHeight;
    const w = GARAGE.doorZ1 - GARAGE.doorZ0;
    const tex = makeLabelTexture('', '#3b3f52', '#000', 64, 64);
    const mat = new THREE.MeshLambertMaterial({ color: 0x8b93a8, map: tex });
    this.panel = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, w), mat);
    // Ribs
    const ribs = new PrimitiveBatch();
    for (let y = 0.2; y < h; y += 0.32) ribs.box(0.07, y - h / 2, 0, 0.02, 0.05, w, '#5d6377');
    this.panel.add(new THREE.Mesh(ribs.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
    this.panel.position.set(GARAGE.maxX - 0.15, h / 2, (GARAGE.doorZ0 + GARAGE.doorZ1) / 2);
    this.panel.castShadow = true;
    group.add(this.panel);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, w, 12), new THREE.MeshLambertMaterial({ color: 0x2a2d38 }));
    drum.rotation.x = Math.PI / 2;
    drum.position.set(GARAGE.maxX - 0.4, h + 0.15, (GARAGE.doorZ0 + GARAGE.doorZ1) / 2);
    group.add(drum);
    this.box = world.add(GARAGE.maxX - 0.25, 0, GARAGE.doorZ0, GARAGE.maxX, h, GARAGE.doorZ1, { blocksSight: true, tag: 'garage-door' });
    this.body = physics.addStaticBox(GARAGE.maxX - 0.12, h / 2, (GARAGE.doorZ0 + GARAGE.doorZ1) / 2, 0.12, h / 2, w / 2);
  }

  toggle(): void {
    this.open = !this.open;
    this.onMove?.(this.open);
  }

  setOpen(open: boolean, instant = false): void {
    this.open = open;
    if (instant) this.amount = open ? 1 : 0;
  }

  update(dt: number): void {
    const target = this.open ? 1 : 0;
    const speed = 0.45;
    if (this.amount < target) this.amount = Math.min(target, this.amount + speed * dt);
    else if (this.amount > target) this.amount = Math.max(target, this.amount - speed * dt);
    const h = GARAGE.doorHeight;
    const visible = Math.max(0.04, 1 - this.amount);
    this.panel.scale.y = visible;
    this.panel.position.y = h - (h * visible) / 2;
    // Bottom edge of the door; once above head height it no longer blocks.
    const bottom = h * (1 - visible);
    this.box.minY = bottom;
    this.box.blocksSight = this.amount < 0.5;
    this.body.position.y = h / 2 + bottom;
    this.body.aabbNeedsUpdate = true;
  }
}

export interface LandmarkResult {
  storeDoor: Door;
  storeBell: PushButton;
  garageDoor: GarageDoor;
  garageButtons: PushButton[];
  saveTerminalAnchor: THREE.Object3D;
  dropboxAnchor: THREE.Object3D;
  blasterSpawn: THREE.Vector3;
  updatables: { update(dt: number): void }[];
  signs: NeonSign[];
}

/**
 * Hand-built points of interest: NEON 24 (enterable store), VOLT gas station,
 * safehouse garage, impound lot, dispatch plaza, KAI RAMEN drop box, precinct lot.
 */
export class Landmarks {
  readonly group = new THREE.Group();
  private readonly signs: NeonSign[] = [];
  private readonly glowTex = makeGlowTexture();

  constructor(
    private readonly city: CityBuilder,
    private readonly world: StaticWorld,
    private readonly physics: PhysicsWorld,
    private readonly props: PropFactory,
  ) {
    this.group.name = 'Landmarks';
  }

  build(): LandmarkResult {
    const { door, bell } = this.buildStore();
    this.buildGasStation();
    const garage = this.buildGarage();
    this.buildImpound();
    this.buildPlaza();
    const dropbox = this.buildKaiRamen();
    this.buildPrecinctLot();
    return {
      storeDoor: door,
      storeBell: bell,
      garageDoor: garage.door,
      garageButtons: garage.buttons,
      saveTerminalAnchor: garage.terminal,
      dropboxAnchor: dropbox,
      blasterSpawn: new THREE.Vector3(GARAGE.minX + 0.75, 1.02, 22.5),
      updatables: [],
      signs: this.signs,
    };
  }

  private sign(text: string, color: string, width: number, x: number, y: number, z: number, rotY: number, opts: { sub?: string; color2?: string; flicker?: boolean } = {}): NeonSign {
    const s = new NeonSign(text, color, width, opts);
    s.group.position.set(x, y, z);
    s.group.rotation.y = rotY;
    this.group.add(s.group);
    this.signs.push(s);
    return s;
  }

  private glowPool(x: number, z: number, size: number, color: number, opacity = 0.35): void {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: this.glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.04, z);
    m.renderOrder = 2;
    this.group.add(m);
  }

  // ------------------------------------------------------------------ NEON 24
  private buildStore(): { door: Door; bell: PushButton } {
    const S = STORE;
    const t = 0.3;
    const solid = this.city.solid.bind(this.city);
    // Walls
    solid(S.minX, 0, S.minZ, S.maxX, S.height, S.minZ + t, { sight: true });
    solid(S.minX, 0, S.minZ, S.minX + t, S.height, S.maxZ, { sight: true });
    solid(S.maxX - t, 0, S.minZ, S.maxX, S.height, S.maxZ, { sight: true });
    solid(S.minX, 0, S.maxZ - t, S.doorX0, S.height, S.maxZ, { sight: true });
    solid(S.doorX1, 0, S.maxZ - t, S.maxX, S.height, S.maxZ, { sight: true });
    solid(S.doorX0, 2.4, S.maxZ - t, S.doorX1, S.height, S.maxZ, { sight: true, walk: false });
    solid(S.minX, S.height, S.minZ, S.maxX, S.height + 0.3, S.maxZ, { sight: false, walk: false, cars: false });

    // Exterior shell
    const ext = new QuadBatch();
    const white = new THREE.Color('#e7e3ee');
    ext.walls(S.minX, S.minZ, S.maxX, S.maxZ, 0, S.height + 0.3, 4, 4, white);
    ext.floor(S.minX, S.minZ, S.maxX, S.maxZ, S.height + 0.3, 4, new THREE.Color('#3a3842'));
    const extMesh = new THREE.Mesh(ext.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    extMesh.castShadow = true;
    this.group.add(extMesh);
    const trim = new PrimitiveBatch();
    trim.box((S.minX + S.maxX) / 2, S.height - 0.2, S.maxZ + 0.03, S.maxX - S.minX, 0.4, 0.06, '#ff4fd8');
    trim.box((S.minX + S.maxX) / 2, S.height - 0.6, S.maxZ + 0.03, S.maxX - S.minX, 0.25, 0.06, '#3df5ff');
    this.group.add(new THREE.Mesh(trim.build(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));
    // Storefront glass (glowing interior look) either side of the door.
    const glassMat = new THREE.MeshBasicMaterial({ color: 0xfff1d6, transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false });
    for (const [x0, x1] of [
      [S.minX + 1, S.doorX0 - 0.6],
      [S.doorX1 + 0.6, S.maxX - 1],
    ]) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 2.2), glassMat);
      g.position.set((x0 + x1) / 2, 1.5, S.maxZ + 0.02);
      this.group.add(g);
    }
    this.sign('NEON 24', '#3df5ff', 6, (S.doorX0 + S.doorX1) / 2, 3.6, S.maxZ + 0.12, 0, { sub: '편의점 · OPEN', color2: '#ff4fd8' });
    this.glowPool((S.doorX0 + S.doorX1) / 2, S.maxZ + 3, 10, 0x9fe8ff, 0.3);

    // Interior
    const inner = new QuadBatch();
    inner.innerWalls(S.minX + t, S.minZ + t, S.maxX - t, S.maxZ - t, 0, S.height, 2.5, new THREE.Color('#fff0d6'));
    // Interiors get a warm emissive base: the hemisphere sky light is not occluded indoors.
    const innerMesh = new THREE.Mesh(inner.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide, emissive: 0x4a3b28 }));
    this.group.add(innerMesh);
    const floor = new QuadBatch();
    floor.floor(S.minX + t, S.minZ + t, S.maxX - t, S.maxZ - t, 0.035, 1.2, new THREE.Color('#ffffff'));
    const floorMesh = new THREE.Mesh(floor.build(), new THREE.MeshLambertMaterial({ map: makeTileFloorTexture(), vertexColors: true, color: 0xfff2dc, emissive: 0x3a3020 }));
    floorMesh.receiveShadow = true;
    this.group.add(floorMesh);
    // Ceiling (faces down) + light panels
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(S.maxX - S.minX, S.maxZ - S.minZ), new THREE.MeshLambertMaterial({ color: 0xd9d6e0 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set((S.minX + S.maxX) / 2, S.height - 0.02, (S.minZ + S.maxZ) / 2);
    this.group.add(ceil);
    const panels = new PrimitiveBatch();
    for (let x = S.minX + 3; x < S.maxX - 2; x += 4) for (let z = S.minZ + 3; z < S.maxZ - 2; z += 4) panels.box(x, S.height - 0.06, z, 1.6, 0.04, 0.6, '#fffaf0');
    this.group.add(new THREE.Mesh(panels.build(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));
    const light = new THREE.PointLight(0xfff0d8, 60, 16, 2);
    light.position.set((S.minX + S.maxX) / 2, S.height - 0.6, (S.minZ + S.maxZ) / 2);
    this.group.add(light);

    // Fixtures: counter, shelves with products, cooler
    const fx = new PrimitiveBatch();
    const counter = { minX: 44.5, maxX: 46.6, minZ: -28.5, maxZ: -21 };
    fx.box((counter.minX + counter.maxX) / 2, 0.5, (counter.minZ + counter.maxZ) / 2, counter.maxX - counter.minX, 1.0, counter.maxZ - counter.minZ, '#2d2a3a');
    fx.box((counter.minX + counter.maxX) / 2, 1.02, (counter.minZ + counter.maxZ) / 2, counter.maxX - counter.minX + 0.1, 0.05, counter.maxZ - counter.minZ + 0.1, '#c9c4d6');
    fx.box(45.4, 1.2, -24.5, 0.45, 0.32, 0.4, '#1c1c24'); // register
    solid(counter.minX, 0, counter.minZ, counter.maxX, 1.05, counter.maxZ, { sight: false, cars: false });
    const shelfCols = ['#ff4f6e', '#ffd23f', '#3dffb0', '#3df5ff', '#c77dff', '#ff9a3d', '#ffffff'];
    let ci = 0;
    for (const sx of [49.5, 53.5, 57.2]) {
      const z0 = -33;
      const z1 = -24;
      fx.box(sx, 0.9, (z0 + z1) / 2, 0.9, 1.8, z1 - z0, '#3b3a48');
      for (const level of [0.35, 0.85, 1.35]) {
        for (let z = z0 + 0.4; z < z1 - 0.3; z += 0.42) {
          for (const side of [-1, 1]) {
            const c = shelfCols[ci++ % shelfCols.length];
            fx.box(sx + side * 0.36, level + 0.14, z, 0.16, 0.26, 0.3, c);
          }
        }
      }
      solid(sx - 0.5, 0, z0, sx + 0.5, 1.8, z1, { sight: false, cars: false });
    }
    fx.box(52, 1.1, S.minZ + t + 0.35, 12, 2.2, 0.7, '#20232e');
    solid(46, 0, S.minZ + t, 58, 2.2, S.minZ + t + 0.7, { sight: false, cars: false });
    this.group.add(new THREE.Mesh(fx.build(), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x1a1612 })));
    const cooler = new THREE.Mesh(new THREE.PlaneGeometry(11.6, 1.9), new THREE.MeshBasicMaterial({ color: 0xbfe9ff, toneMapped: false, transparent: true, opacity: 0.85 }));
    cooler.position.set(52, 1.15, S.minZ + t + 0.71);
    this.group.add(cooler);
    const coolerSign = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.5), new THREE.MeshBasicMaterial({ map: makeLabelTexture('COLD DRINKS · 음료', '#0b2a3a', '#9ff8ff'), toneMapped: false }));
    coolerSign.position.set(52, 2.5, S.minZ + t + 0.72);
    this.group.add(coolerSign);

    // Soda cans on the counter end + a crate by the door.
    const canColors = [0xff3d6e, 0x3df5ff, 0xffd23f, 0x3dffb0];
    canColors.forEach((c, i) => this.props.sodaCan(new THREE.Vector3(45.2 + (i % 2) * 0.12, 1.12, -22.0 - Math.floor(i / 2) * 0.12), c));
    this.props.crate(new THREE.Vector3(58.6, 0, -20.2), 0.5);

    // Hinged glass door (opens both ways; select toggles outward).
    const pivot = new THREE.Group();
    pivot.position.set(S.doorX0, 0, S.maxZ - t / 2);
    const w = S.doorX1 - S.doorX0;
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x2a2d3a });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w, 2.35, 0.06), frameMat);
    frame.position.set(w / 2, 1.18, 0);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.2, 2.0), new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
    glass.position.set(w / 2, 1.2, 0.035);
    const handleMat = new THREE.MeshLambertMaterial({ color: 0xd0d6e4, emissive: 0x202020 });
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.04), handleMat);
    handle.position.set(w - 0.18, 1.05, 0.09);
    const handle2 = handle.clone();
    handle2.position.z = -0.09;
    const pushPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.18), new THREE.MeshBasicMaterial({ map: makeLabelTexture('PUSH / PULL', '#ff4fd8', '#fff', 256, 96), toneMapped: false }));
    pushPlate.position.set(w / 2, 1.5, 0.04);
    pivot.add(frame, glass, handle, handle2, pushPlate);
    this.group.add(pivot);
    const door = new Door({
      id: 'store_door',
      pivot,
      meshes: [frame, handle, handle2],
      handle: new THREE.Vector3(w - 0.18, 1.05, 0),
      width: w,
      thickness: 0.08,
      minAngle: -1.65,
      maxAngle: 1.65,
      panelSign: 1,
    });

    // Service bell on the counter (poke or select).
    const bellBase = new THREE.Group();
    bellBase.position.set(45.9, 1.045, -23.0);
    bellBase.rotation.x = -Math.PI / 2;
    this.group.add(bellBase);
    const bell = new PushButton('store_bell', bellBase, 0.04, 0xffd23f, '벨 누르기');
    return { door, bell };
  }

  // ------------------------------------------------------------- VOLT gas
  private buildGasStation(): void {
    const G = GAS;
    const pad = new QuadBatch();
    pad.floor(G.minX, G.minZ, G.maxX, G.maxZ, 0.03, 4, new THREE.Color('#77737f'));
    const padMesh = new THREE.Mesh(pad.build(), new THREE.MeshLambertMaterial({ map: makePlazaTexture(), vertexColors: true, color: 0x9a96a6 }));
    padMesh.receiveShadow = true;
    this.group.add(padMesh);
    const c = { minX: 16, maxX: 36, minZ: -34, maxZ: -18 };
    const parts = new PrimitiveBatch();
    parts.box((c.minX + c.maxX) / 2, G.canopyY + 0.3, (c.minZ + c.maxZ) / 2, c.maxX - c.minX, 0.6, c.maxZ - c.minZ, '#e8e6ef');
    parts.box((c.minX + c.maxX) / 2, G.canopyY + 0.3, c.maxZ + 0.02, c.maxX - c.minX, 0.5, 0.05, '#2aff9a');
    for (const [px, pz] of [
      [c.minX + 1, c.minZ + 1],
      [c.maxX - 1, c.minZ + 1],
      [c.minX + 1, c.maxZ - 1],
      [c.maxX - 1, c.maxZ - 1],
    ]) {
      parts.box(px, G.canopyY / 2, pz, 0.5, G.canopyY, 0.5, '#c9c6d4');
      this.city.solid(px - 0.25, 0, pz - 0.25, px + 0.25, G.canopyY, pz + 0.25, { sight: false });
    }
    for (const ix of [21, 31]) {
      parts.box(ix, 0.1, -26, 1.4, 0.2, 5, '#9a96a6');
      for (const pz of [-27.4, -24.6]) {
        parts.box(ix, 0.95, pz, 0.8, 1.7, 0.55, '#1f6b5a');
        parts.box(ix, 1.35, pz + 0.29, 0.5, 0.35, 0.02, '#c8fff0');
      }
      this.city.solid(ix - 0.7, 0, -28.5, ix + 0.7, 1.8, -23.5, { sight: false });
    }
    const canopyMesh = new THREE.Mesh(parts.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    canopyMesh.castShadow = true;
    this.group.add(canopyMesh);
    // Underside light panel
    const under = new THREE.Mesh(new THREE.PlaneGeometry(c.maxX - c.minX - 1, c.maxZ - c.minZ - 1), new THREE.MeshBasicMaterial({ color: 0xf4fff8, toneMapped: false }));
    under.rotation.x = Math.PI / 2;
    under.position.set((c.minX + c.maxX) / 2, G.canopyY - 0.01, (c.minZ + c.maxZ) / 2);
    this.group.add(under);
    this.glowPool(26, -26, 26, 0xc8ffe8, 0.28);
    this.sign('VOLT GAS', '#2aff9a', 7, 26, G.canopyY + 0.3, c.maxZ + 0.1, 0, { color2: '#ffffff' });
    // Price pylon
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), new THREE.MeshLambertMaterial({ color: 0x2a2d3a }));
    pylon.position.set(13.5, 3, -13.5);
    this.group.add(pylon);
    this.city.solid(13.3, 0, -13.7, 13.7, 6, -13.3, { sight: false });
    this.sign('VOLT 1.89', '#ffd23f', 3, 13.5, 5.4, -13.2, Math.PI / 4, { color2: '#2aff9a' });
    // Dynamic props
    this.props.trashCan(new THREE.Vector3(18.5, 0, -22));
    this.props.trashCan(new THREE.Vector3(38.5, 0, -14));
    this.props.cone(new THREE.Vector3(24, 0, -14.5));
    this.props.cone(new THREE.Vector3(28, 0, -14.5));
  }

  // ------------------------------------------------------------- Safehouse garage
  private buildGarage(): { door: GarageDoor; buttons: PushButton[]; terminal: THREE.Object3D } {
    const G = GARAGE;
    const t = 0.3;
    const solid = this.city.solid.bind(this.city);
    solid(G.minX, 0, G.minZ, G.maxX, G.height, G.minZ + t, { sight: true });
    solid(G.minX, 0, G.maxZ - t, G.maxX, G.height, G.maxZ, { sight: true });
    solid(G.minX, 0, G.minZ, G.minX + t, G.height, G.maxZ, { sight: true });
    solid(G.maxX - t, 0, G.minZ, G.maxX, G.height, G.doorZ0, { sight: true });
    solid(G.maxX - t, 0, G.doorZ1, G.maxX, G.height, G.maxZ, { sight: true });
    solid(G.maxX - t, G.doorHeight, G.doorZ0, G.maxX, G.height, G.doorZ1, { sight: true, walk: false });
    solid(G.minX, G.height, G.minZ, G.maxX, G.height + 0.3, G.maxZ, { sight: false, walk: false, cars: false });

    const ext = new QuadBatch();
    ext.walls(G.minX, G.minZ, G.maxX, G.maxZ, 0, G.height + 0.3, 4, 4, new THREE.Color('#6e6a78'));
    ext.floor(G.minX, G.minZ, G.maxX, G.maxZ, G.height + 0.3, 4, new THREE.Color('#2e2c35'));
    const extMesh = new THREE.Mesh(ext.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    extMesh.castShadow = true;
    this.group.add(extMesh);
    // Cut-out: dark opening plane is covered by the door panel; inner walls:
    const inner = new QuadBatch();
    inner.innerWalls(G.minX + t, G.minZ + t, G.maxX - t, G.maxZ - t, 0, G.height, 3, new THREE.Color('#9a97a8'));
    this.group.add(new THREE.Mesh(inner.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
    const floor = new QuadBatch();
    floor.floor(G.minX + t, G.minZ + t, G.maxX - t, G.maxZ - t, 0.035, 3, new THREE.Color('#8d8a96'));
    this.group.add(new THREE.Mesh(floor.build(), new THREE.MeshLambertMaterial({ map: makePlazaTexture(), vertexColors: true })));
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(G.maxX - G.minX, G.maxZ - G.minZ), new THREE.MeshLambertMaterial({ color: 0x55525e }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set((G.minX + G.maxX) / 2, G.height - 0.02, (G.minZ + G.maxZ) / 2);
    this.group.add(ceil);
    const light = new THREE.PointLight(0xbfdcff, 45, 18, 2);
    light.position.set(-23, G.height - 0.7, 23);
    this.group.add(light);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(6, 0.06, 0.25), new THREE.MeshBasicMaterial({ color: 0xe0f0ff, toneMapped: false }));
    strip.position.set(-23, G.height - 0.08, 23);
    this.group.add(strip);

    // Workbench + shelves
    const fx = new PrimitiveBatch();
    fx.box(G.minX + 0.8, 0.47, 22.5, 1.0, 0.94, 6, '#5b4636');
    fx.box(G.minX + 0.8, 0.96, 22.5, 1.1, 0.06, 6.1, '#8a6a4e');
    fx.box(G.minX + 0.32, 2.0, 22.5, 0.05, 1.4, 5.5, '#2f3340'); // pegboard
    for (let z = 20.3; z < 25; z += 0.6) fx.box(G.minX + 0.38, 2.0 + Math.sin(z * 3) * 0.3, z, 0.06, 0.35, 0.08, '#c8ccd8');
    fx.box(G.minX + 0.6, 1.0, 29.5, 0.8, 2.0, 3, '#3a3f4f'); // shelf
    solid(G.minX + t, 0, 19.5, G.minX + 1.3, 1.0, 25.5, { sight: false, cars: true });
    solid(G.minX + t, 0, 28, G.minX + 1.0, 2.0, 31, { sight: false });
    this.group.add(new THREE.Mesh(fx.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
    // Safehouse floor marking
    const mark = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.4, 40), new THREE.MeshBasicMaterial({ color: 0x3dffb0, transparent: true, opacity: 0.4, depthWrite: false }));
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(-21, 0.05, 23);
    this.group.add(mark);

    const door = new GarageDoor(this.group, this.world, this.physics);
    this.sign('GARAGE 13', '#3dffb0', 4, G.maxX + 0.12, G.doorHeight + 1.2, 23, Math.PI / 2, { color2: '#ffffff' });

    const buttons: PushButton[] = [];
    const inside = new THREE.Group();
    inside.position.set(G.maxX - t - 0.01, 1.3, G.doorZ0 - 0.6);
    inside.rotation.y = -Math.PI / 2;
    const outside = new THREE.Group();
    outside.position.set(G.maxX + 0.01, 1.3, G.doorZ0 - 0.6);
    outside.rotation.y = Math.PI / 2;
    this.group.add(inside, outside);
    buttons.push(new PushButton('garage_btn_in', inside, 0.045, 0x3dffb0, '차고 문'));
    buttons.push(new PushButton('garage_btn_out', outside, 0.045, 0x3dffb0, '차고 문'));
    for (const b of buttons) b.onPress = () => door.toggle();

    const terminal = new THREE.Group();
    terminal.position.set(-26, 1.55, G.minZ + t + 0.05);
    this.group.add(terminal);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.65, 0.06), new THREE.MeshLambertMaterial({ color: 0x15171f }));
    bezel.position.z = -0.03;
    terminal.add(bezel);
    // crates in the garage
    this.props.crate(new THREE.Vector3(-30.5, 0, 30.4), 0.6);
    this.props.crate(new THREE.Vector3(-29.6, 0, 30.6), 0.45);
    return { door, buttons, terminal };
  }

  // ------------------------------------------------------------- Impound lot
  private buildImpound(): void {
    const I = IMPOUND;
    const h = 2.4;
    const fenceMat = new THREE.MeshLambertMaterial({ color: 0x5c6070, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    const posts = new PrimitiveBatch();
    const segs: [number, number, number, number][] = [
      [I.minX, I.minZ, I.gateX0, I.minZ],
      [I.gateX1, I.minZ, I.maxX, I.minZ],
      [I.minX, I.maxZ, I.maxX, I.maxZ],
      [I.minX, I.minZ, I.minX, I.maxZ],
      [I.maxX, I.minZ, I.maxX, I.maxZ],
    ];
    for (const [x0, z0, x1, z1] of segs) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, h), fenceMat);
      panel.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
      panel.rotation.y = x0 === x1 ? Math.PI / 2 : 0;
      this.group.add(panel);
      const n = Math.ceil(len / 2.5);
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        posts.box(x0 + (x1 - x0) * f, h / 2, z0 + (z1 - z0) * f, 0.1, h, 0.1, '#3a3d48');
      }
      posts.box((x0 + x1) / 2, h, (z0 + z1) / 2, Math.max(0.08, Math.abs(x1 - x0)), 0.08, Math.max(0.08, Math.abs(z1 - z0)), '#3a3d48');
      this.city.solid(Math.min(x0, x1) - 0.08, 0, Math.min(z0, z1) - 0.08, Math.max(x0, x1) + 0.08, h, Math.max(z0, z1) + 0.08, { sight: false, tag: 'fence' });
    }
    // Swung-open gate leaf
    posts.box(I.gateX0 - 0.1, h / 2, I.minZ - 2, 0.08, h * 0.9, 4, '#4a4e5c');
    // Impounded cars (static shells)
    const cars: [number, number, string][] = [
      [48, 64, '#6d2a3a'],
      [48, 74, '#2a4a6d'],
      [66, 70, '#4a4a4a'],
    ];
    for (const [cx, cz, col] of cars) {
      posts.box(cx, 0.55, cz, 1.8, 0.7, 4.2, col);
      posts.box(cx, 1.15, cz + 0.2, 1.6, 0.55, 2.2, '#22242c');
      this.city.solid(cx - 0.9, 0, cz - 2.1, cx + 0.9, 1.45, cz + 2.1, { sight: false, tag: 'wreck' });
    }
    // Crate holding the data chip
    posts.box(57, 0.45, 70, 2, 0.9, 2, '#6a5236');
    this.city.solid(56, 0, 69, 58, 0.9, 71, { sight: false });
    // Floodlight
    posts.box(I.maxX - 1, 3.5, I.minZ + 1, 0.15, 7, 0.15, '#2a2d38');
    const m = new THREE.Mesh(posts.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.castShadow = true;
    this.group.add(m);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.4), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    lamp.position.set(I.maxX - 1.4, 6.9, I.minZ + 1.4);
    this.group.add(lamp);
    this.glowPool(60, 66, 18, 0xdfe8ff, 0.25);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: makeLabelTexture('IMPOUND · 출입금지', '#d9b21f', '#111'), side: THREE.DoubleSide }));
    plate.position.set(I.gateX0 - 3, 1.6, I.minZ - 0.06);
    plate.rotation.y = Math.PI;
    this.group.add(plate);
    this.props.cone(new THREE.Vector3(I.gateX0 + 0.5, 0, I.minZ - 1.5));
    this.props.cone(new THREE.Vector3(I.gateX1 - 0.5, 0, I.minZ - 1.5));
  }

  // ------------------------------------------------------------- Plaza
  private buildPlaza(): void {
    const P = PLAZA;
    const q = new QuadBatch();
    q.floor(P.minX, P.minZ, P.maxX, P.maxZ, 0.03, 4, new THREE.Color('#ffffff'));
    // parking bay next to the plaza (player car)
    q.floor(-30, -38, -10, -12, 0.03, 4, new THREE.Color('#8a8796'));
    const plaza = new THREE.Mesh(q.build(), new THREE.MeshLambertMaterial({ map: makePlazaTexture(), vertexColors: true }));
    plaza.receiveShadow = true;
    this.group.add(plaza);
    // parking lines
    const lines = new PrimitiveBatch();
    for (let x = -28; x <= -12; x += 4) lines.box(x, 0.04, -31, 0.12, 0.01, 6, '#e9ecf2');
    this.group.add(new THREE.Mesh(lines.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
    // Fountain
    const fx = P.fountainX;
    const fz = P.fountainZ;
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.2, 0.6, 32, 1, true), new THREE.MeshLambertMaterial({ color: 0x7c7888, side: THREE.DoubleSide }));
    basin.position.set(fx, 0.3, fz);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(4.05, 0.15, 6, 40), new THREE.MeshLambertMaterial({ color: 0x9a96a6 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(fx, 0.6, fz);
    const water = new THREE.Mesh(new THREE.CircleGeometry(3.95, 32), new THREE.MeshBasicMaterial({ color: 0x1fb6c9, transparent: true, opacity: 0.8, toneMapped: false }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(fx, 0.45, fz);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 2.4, 12), new THREE.MeshLambertMaterial({ color: 0x8d8a9a }));
    pillar.position.set(fx, 1.2, fz);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.06, 8, 32), new THREE.MeshBasicMaterial({ color: 0xff4fd8, toneMapped: false }));
    ring.position.set(fx, 2.6, fz);
    ring.rotation.x = Math.PI / 2;
    this.group.add(basin, rim, water, pillar, ring);
    this.city.solid(fx - 3.4, 0, fz - 3.4, fx + 3.4, 0.7, fz + 3.4, { sight: false });
    this.city.solid(fx - 0.6, 0, fz - 0.6, fx + 0.6, 2.4, fz + 0.6, { sight: false });
    this.glowPool(fx, fz, 14, 0x3df5ff, 0.25);

    // Dispatch kiosk next to the mission giver
    const kx = MISSION_GIVER.x + 3.2;
    const kz = MISSION_GIVER.z - 1.5;
    const kiosk = new PrimitiveBatch();
    kiosk.box(kx, 1.3, kz, 2.4, 2.6, 1.6, '#2b2f40');
    kiosk.box(kx, 2.7, kz, 2.8, 0.2, 2.0, '#ff7a3d');
    kiosk.box(kx, 1.2, kz + 0.81, 1.8, 0.9, 0.02, '#ffd9a8');
    this.group.add(new THREE.Mesh(kiosk.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
    this.city.solid(kx - 1.2, 0, kz - 0.8, kx + 1.2, 2.6, kz + 0.8, { sight: false });
    this.sign('DISPATCH', '#ff9a3d', 2.6, kx, 3.25, kz + 0.2, 0, { color2: '#ffd23f' });
    this.glowPool(kx, kz + 2, 7, 0xff9a3d, 0.35);
    // A few loose props in the plaza
    this.props.trashCan(new THREE.Vector3(-36.5, 0, -16.5));
    this.props.trashCan(new THREE.Vector3(-76, 0, -16));
    this.props.cone(new THREE.Vector3(-26, 0, -13));
    this.props.crate(new THREE.Vector3(-74, 0, -64), 0.6);
  }

  // ------------------------------------------------------------- KAI RAMEN
  private buildKaiRamen(): THREE.Object3D {
    const s = SOCKETS.kai_dropbox;
    const box = new PrimitiveBatch();
    box.box(s.x, 0.45, s.z, 0.8, 0.9, 0.9, '#7a1f1f');
    box.box(s.x, 0.92, s.z, 0.86, 0.06, 0.96, '#3a0f0f');
    this.group.add(new THREE.Mesh(box.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
    const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ color: 0xffb36b, transparent: true, opacity: 0.6, toneMapped: false }));
    slot.rotation.x = -Math.PI / 2;
    slot.position.set(s.x, 0.955, s.z);
    this.group.add(slot);
    this.city.solid(s.x - 0.4, 0, s.z - 0.45, s.x + 0.4, 0.9, s.z + 0.45, { sight: false, cars: true });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.2), new THREE.MeshBasicMaterial({ map: makeLabelTexture('배송함 DROP', '#ffb36b', '#2a0a0a', 256, 72), toneMapped: false }));
    label.position.set(s.x - 0.41, 0.65, s.z);
    label.rotation.y = -Math.PI / 2;
    this.group.add(label);
    // Lanterns
    for (const dz of [-4, 4]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff4a2a, toneMapped: false }));
      l.scale.y = 1.3;
      l.position.set(-100.3, 3.2, 62 + dz);
      this.group.add(l);
      this.glowPool(-101.5, 62 + dz, 4, 0xff6a3a, 0.4);
    }
    const anchor = new THREE.Group();
    anchor.position.set(s.x, s.y + 0.1, s.z);
    this.group.add(anchor);
    return anchor;
  }

  // ------------------------------------------------------------- Precinct lot
  private buildPrecinctLot(): void {
    const lines = new PrimitiveBatch();
    for (let x = 46; x <= 70; x += 5) lines.box(x, 0.04, 92, 0.12, 0.01, 6, '#e9ecf2');
    lines.box(80, 0.05, 63.5, 16, 0.02, 0.3, '#4d8bff');
    this.group.add(new THREE.Mesh(lines.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 30), new THREE.MeshBasicMaterial({ color: 0x4d8bff, toneMapped: false }));
    bar.position.set(71.9, 10, 82);
    this.group.add(bar);
    this.glowPool(60, 92, 20, 0x4d8bff, 0.2);
  }
}
