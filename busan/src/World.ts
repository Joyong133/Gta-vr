/**
 * 지역 에셋을 불러와 씬을 구성하고, 거리에 따라 타일을 켜고 끈다(Quest 부하 조절).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Footprints, Ground, HeightGrid } from './Ground';
import { MaterialLibrary, SKY_HORIZON, SUN_DIR, skyMesh } from './materials';
import type { Region, Spawn } from './regions';

type TileKind = 'terrain' | 'backdrop' | 'building' | 'buildingLow' | 'tower' | 'road' | 'lane' | 'bridge' | 'misc' | 'trees';

interface Tile {
  obj: THREE.Object3D;
  kind: TileKind;
  box: THREE.Box3;
  tris: number;
}

export interface RegionSpawn extends Spawn {
  region: string;
}

/** 지도 좌표(x=동, y=북, z=위) → three.js 좌표 */
export function toThree(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x, z, -y);
}

function kindOf(name: string): TileKind {
  if (name.startsWith('BuildingsLow_')) return 'buildingLow';
  if (name.startsWith('Buildings_')) return 'building';
  if (name.startsWith('Tower_')) return 'tower';
  if (name.startsWith('Roads_')) return 'road';
  if (name.startsWith('Lanes_')) return 'lane';
  if (name.startsWith('Terrain')) return 'terrain';
  if (name.startsWith('Backdrop')) return 'backdrop';
  if (name.startsWith('Bridge')) return 'bridge';
  return 'misc';
}

/** 카메라 수평 거리(m) 기준 표시 범위. alt = 지면 위 눈높이. */
function range(kind: TileKind, alt: number): number {
  switch (kind) {
    case 'road':
      return 2500 + alt * 2;
    case 'lane':
      return 700 + alt;
    case 'trees':
      return Math.min(1200 + alt, 3000);
    case 'buildingLow':
      return 2500 + alt * 3;
    case 'building':
      return 9000 + alt * 4;
    default:
      return Infinity;
  }
}

async function fetchBuffer(url: string, onLength: (n: number) => void, onBytes: (n: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  onLength(Number(res.headers.get('content-length')) || 0);
  if (!res.body) {
    const b = await res.arrayBuffer();
    onBytes(b.byteLength);
    return b;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    onBytes(value.byteLength);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out.buffer;
}

function treeGeometry(): THREE.BufferGeometry {
  const crown = new THREE.ConeGeometry(3, 7.5, 6, 1, true).translate(0, 2.2 + 3.75, 0);
  const trunk = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 3, 1, true).translate(0, 1.2, 0);
  const paint = (g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry => {
    const n = g.getAttribute('position').count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(a, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const g = mergeGeometries([
    paint(crown, new THREE.Color().setRGB(0.06, 0.13, 0.035, THREE.LinearSRGBColorSpace)),
    paint(trunk, new THREE.Color().setRGB(0.12, 0.08, 0.05, THREE.LinearSRGBColorSpace)),
  ]);
  if (!g) throw new Error('나무 지오메트리 병합 실패');
  return g;
}

export class World {
  readonly root = new THREE.Group();
  readonly ground = new Ground();
  readonly regions: Region[] = [];
  readonly spawns: RegionSpawn[] = [];
  readonly tiles: Tile[] = [];
  readonly sky = skyMesh(40000);
  private readonly sea: THREE.Mesh;
  private readonly loader = new GLTFLoader();
  private readonly libs: MaterialLibrary[] = [];
  private readonly treeGeo = treeGeometry();
  private readonly treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, name: 'Trees', side: THREE.DoubleSide });
  private visTimer = 0;

  constructor(readonly scene: THREE.Scene) {
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    scene.add(this.root);
    scene.add(this.sky);
    scene.fog = new THREE.Fog(SKY_HORIZON.clone(), 2500, 32000);
    scene.background = SKY_HORIZON.clone();
    const hemi = new THREE.HemisphereLight(
      new THREE.Color().setRGB(0.7, 0.8, 1.0, THREE.LinearSRGBColorSpace),
      new THREE.Color().setRGB(0.28, 0.25, 0.2, THREE.LinearSRGBColorSpace),
      1.5,
    );
    const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1.0, 0.93, 0.82, THREE.LinearSRGBColorSpace), 2.4);
    sun.position.copy(SUN_DIR).multiplyScalar(1000);
    this.root.add(hemi, sun);
    // 거대한 삼각형 두 장이면 일부 GPU/각도에서 클리핑 정밀도가 깨져 바다가 땅 위로 그려진다 → 잘게 나누고 카메라를 따라다니게 한다
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000, 64, 64).rotateX(-Math.PI / 2));
    this.sea.name = 'Sea';
    this.sea.visible = false;
    this.root.add(this.sea);
  }

  /** 지역 하나를 불러온다. 여러 번 호출하면 같은 좌표계로 이어 붙는다. */
  async load(region: Region, onProgress: (frac: number, label: string) => void): Promise<void> {
    const f = region.files;
    const glbs = ['terrain', 'backdrop', 'city', 'roads'].filter((k) => f[k]);
    const bins = ['buildings', 'trees'].filter((k) => f[k]);
    const files = [...glbs.map((k) => f[k]), region.height.file, ...bins.map((k) => f[k])];
    let loaded = 0;
    let expected = 0;
    const bump = (n: number): void => {
      loaded += n;
      onProgress(Math.min(loaded / Math.max(expected, loaded, 1), 0.98) * 0.9, `${region.name} 내려받는 중 ${(loaded / 1e6).toFixed(1)}MB`);
    };
    const buffers = await Promise.all(files.map((file) => fetchBuffer(region.url(file), (n) => (expected += n), bump)));
    onProgress(0.92, `${region.name} 만드는 중…`);

    const lib = new MaterialLibrary(region.materials);
    this.libs.push(lib);
    this.sea.material = lib.water;
    this.sea.visible = true;
    for (let i = 0; i < glbs.length; i++) {
      const gltf = await this.loader.parseAsync(buffers[i], '');
      for (const node of [...gltf.scene.children]) this.addTile(node, kindOf(node.name), lib);
    }
    const heightBuf = buffers[glbs.length];
    const height = new HeightGrid(region.height, new Int16Array(heightBuf));
    const buildings = new Footprints(buffers[glbs.length + 1]);
    this.ground.add({ height, buildings });
    this.addTrees(new Float32Array(buffers[glbs.length + 2]), height);

    this.regions.push(region);
    for (const s of region.spawns) this.spawns.push({ ...s, region: region.id });
    onProgress(1, `${region.name} 준비 완료`);
  }

  private addTile(obj: THREE.Object3D, kind: TileKind, lib: MaterialLibrary): void {
    let tris = 0;
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const old = mesh.material as THREE.Material;
      mesh.material = lib.get(old.name);
      old.dispose();
      const g = mesh.geometry;
      tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    });
    this.root.add(obj);
    obj.updateMatrixWorld(true);
    obj.traverse((o) => (o.matrixAutoUpdate = false));
    this.tiles.push({ obj, kind, box: new THREE.Box3().setFromObject(obj), tris });
  }

  /** 나무는 지형 메시와 같은 높이맵에 심는다(감량된 지형 위로 뜨거나 묻히지 않게). */
  private addTrees(t: Float32Array, height: HeightGrid): void {
    const n = t.length / 5;
    const groups = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const key = `${Math.floor(t[i * 5] / 1000)},${Math.floor(t[i * 5 + 1] / 1000)}`;
      const g = groups.get(key);
      if (g) g.push(i);
      else groups.set(key, [i]);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    for (const [key, list] of groups) {
      const mesh = new THREE.InstancedMesh(this.treeGeo, this.treeMat, list.length);
      mesh.name = `Trees_${key}`;
      list.forEach((i, k) => {
        const sc = t[i * 5 + 3];
        const h = height.at(t[i * 5], t[i * 5 + 1]);
        toThree(t[i * 5], t[i * 5 + 1], (Number.isNaN(h) ? t[i * 5 + 2] : h) - 0.4, p);
        q.setFromAxisAngle(up, t[i * 5 + 4]);
        m.compose(p, q, s.set(sc, sc * (0.85 + 0.3 * ((k * 0.618) % 1)), sc));
        mesh.setMatrixAt(k, m);
        const v = 0.75 + 0.5 * ((k * 0.3819) % 1);
        mesh.setColorAt(k, c.setRGB(v * 0.95, v, v * 0.85));
      });
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      const box = mesh.boundingBox ? mesh.boundingBox.clone() : new THREE.Box3();
      this.tiles.push({ obj: mesh, kind: 'trees', box, tris: list.length * 12 });
    }
  }

  /** 매 프레임: 하늘을 카메라에 붙이고, 0.25초마다 거리별 타일 표시를 갱신한다. */
  update(dt: number, t: number, cam: THREE.Vector3, altitude: number): void {
    this.sky.position.copy(cam);
    // 격자 한 칸(1250m) 단위로만 옮겨 물결 무늬가 미끄러지지 않게 한다
    this.sea.position.set(Math.round(cam.x / 1250) * 1250, 0, Math.round(cam.z / 1250) * 1250);
    for (const lib of this.libs) lib.tick(t);
    this.visTimer -= dt;
    if (this.visTimer > 0) return;
    this.visTimer = 0.25;
    for (const tile of this.tiles) {
      const r = range(tile.kind, altitude);
      if (r === Infinity) {
        tile.obj.visible = true;
        continue;
      }
      const b = tile.box;
      const dx = Math.max(b.min.x - cam.x, 0, cam.x - b.max.x);
      const dz = Math.max(b.min.z - cam.z, 0, cam.z - b.max.z);
      tile.obj.visible = dx * dx + dz * dz < r * r;
    }
  }

  stats(): { tiles: number; visible: number; trisVisible: number } {
    let visible = 0;
    let tris = 0;
    for (const t of this.tiles) {
      if (t.obj.visible) {
        visible++;
        tris += t.tris;
      }
    }
    return { tiles: this.tiles.length, visible, trisVisible: Math.round(tris) };
  }
}
