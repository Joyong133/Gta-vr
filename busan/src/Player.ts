/**
 * 플레이어 리그와 이동.
 *
 * 리그(rig) = 발 위치. 그 안에 XR 카메라/컨트롤러가 local-floor 기준으로 붙는다.
 * 거인 모드는 리그 크기를 키워(눈 사이 거리도 같이 커져) 도시가 미니어처처럼 보이게 한다.
 *
 * VR (Quest 3 Touch)                         데스크톱
 *   왼스틱      이동(머리 방향 기준)            WASD
 *   왼 그립     달리기 / 비행 가속              Shift
 *   오른스틱 ←→ 45° 스냅 회전                  마우스
 *   오른스틱 ↑  텔레포트 조준 → 놓으면 이동     (걷기) T 누르고 떼기
 *   오른스틱 ↕  (비행 모드) 상승/하강           Space / C
 *   A          걷기 ↔ 비행                    F
 *   B          거인 모드                       G
 *   X / Y      이전 / 다음 장소                [ / ]  또는 숫자 1~0
 */
import * as THREE from 'three';
import type { Ground } from './Ground';
import type { RegionSpawn } from './World';

export type MoveMode = 'walk' | 'fly';

export interface Controls {
  moveX: number;
  moveY: number;
  /** -1 / 0 / 1 (한 번 누를 때마다) */
  snap: number;
  /** 데스크톱 마우스 회전(라디안) */
  yawDelta: number;
  pitchDelta: number;
  vertical: number;
  boost: boolean;
  teleportAim: boolean;
  toggleFly: boolean;
  toggleGiant: boolean;
  spawnStep: number;
  spawnIndex: number;
}

export function emptyControls(): Controls {
  return {
    moveX: 0,
    moveY: 0,
    snap: 0,
    yawDelta: 0,
    pitchDelta: 0,
    vertical: 0,
    boost: false,
    teleportAim: false,
    toggleFly: false,
    toggleGiant: false,
    spawnStep: 0,
    spawnIndex: -1,
  };
}

export const SPEED = { walk: 3, run: 10, fly: 25, flyBoost: 160, vertical: 15 };
const GIANT = 30;
const GRAVITY = 9.8;
const EYE = 1.6;

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

export class Player {
  readonly rig = new THREE.Group();
  mode: MoveMode = 'walk';
  giant = false;
  spawnIndex = 0;
  /** 데스크톱 고개 숙임(라디안) */
  pitch = 0;
  private vy = 0;
  private readonly arc: THREE.Line;
  private readonly marker: THREE.Mesh;
  private teleportTarget: THREE.Vector3 | null = null;
  private wasAiming = false;
  onMessage: (text: string) => void = () => {};

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly ground: Ground,
    private readonly spawns: RegionSpawn[],
  ) {
    this.rig.name = 'PlayerRig';
    this.rig.add(camera);
    const pts = new Float32Array(64 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.arc = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x5ff2ff, fog: false }));
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.5, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x5ff2ff, fog: false, side: THREE.DoubleSide }),
    );
    this.marker.visible = false;
  }

  /** 씬에 텔레포트 표시를 붙인다(리그 밖, 월드 좌표). */
  attach(scene: THREE.Scene): void {
    scene.add(this.rig, this.arc, this.marker);
  }

  get scale(): number {
    return this.giant ? GIANT : 1;
  }

  /** 발 위치(지도 좌표 x=동, y=북, z=높이) */
  feet(): { x: number; y: number; z: number } {
    return { x: this.rig.position.x, y: -this.rig.position.z, z: this.rig.position.y };
  }

  /** 머리(카메라) 월드 위치 */
  head(out = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldPosition(out);
  }

  /** 지면 위 눈높이 */
  altitude(): number {
    const h = this.head(v1);
    return h.y - this.ground.top(h.x, -h.z);
  }

  /** 머리 위치가 (x, 북 y)에 오도록 리그를 옮기고, 방위각 yaw(0=북)를 바라보게 한다. */
  placeAt(x: number, y: number, feetZ: number, yawDeg: number): void {
    this.rig.updateMatrixWorld(true);
    const headLocal = this.camera.position;
    const headYaw = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ').y;
    this.rig.rotation.set(0, -THREE.MathUtils.degToRad(yawDeg) - headYaw, 0);
    this.rig.updateMatrixWorld(true);
    const off = v2.set(headLocal.x, 0, headLocal.z).multiplyScalar(this.scale).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.rig.rotation.y);
    this.rig.position.set(x - off.x, feetZ, -y - off.z);
    this.vy = 0;
  }

  warp(index: number): void {
    if (!this.spawns.length) return;
    const n = this.spawns.length;
    this.spawnIndex = ((index % n) + n) % n;
    const s = this.spawns[this.spawnIndex];
    this.mode = s.mode;
    const base = s.mode === 'fly' ? this.ground.terrain(s.x, s.y) + s.z : this.ground.top(s.x, s.y);
    this.placeAt(s.x, s.y, base, s.yaw);
    this.onMessage(`${this.spawnIndex + 1}. ${s.name}`);
  }

  setGiant(on: boolean): void {
    if (on === this.giant) return;
    const h = this.head(v1);
    this.giant = on;
    this.rig.scale.setScalar(this.scale);
    this.rig.updateMatrixWorld(true);
    // 머리의 수평 위치는 그대로 두고 발을 땅에 붙인다
    const h2 = this.head(v2);
    this.rig.position.x += h.x - h2.x;
    this.rig.position.z += h.z - h2.z;
    if (this.mode === 'walk' || on) this.rig.position.y = this.ground.terrain(h.x, -h.z);
    this.onMessage(on ? '거인 모드 (×30)' : '사람 크기');
  }

  setMode(mode: MoveMode): void {
    this.mode = mode;
    this.vy = 0;
    this.onMessage(mode === 'fly' ? '비행 모드' : '걷기 모드');
  }

  update(dt: number, c: Controls, xr: boolean, aimRay: THREE.Object3D | null): void {
    if (c.spawnIndex >= 0) this.warp(c.spawnIndex);
    else if (c.spawnStep) this.warp(this.spawnIndex + c.spawnStep);
    if (c.toggleFly) this.setMode(this.mode === 'fly' ? 'walk' : 'fly');
    if (c.toggleGiant) this.setGiant(!this.giant);

    // 회전: 스냅은 머리를 축으로, 데스크톱 마우스는 리그 자체를 돌린다
    if (c.snap) this.rotateAroundHead(-c.snap * (Math.PI / 4));
    if (c.yawDelta) this.rotateAroundHead(-c.yawDelta);
    if (!xr) {
      this.pitch = THREE.MathUtils.clamp(this.pitch - c.pitchDelta, -1.45, 1.45);
      this.camera.rotation.set(this.pitch, 0, 0, 'YXZ');
      this.camera.position.set(0, EYE, 0);
    }

    // 머리 방향 기준 수평 이동
    const s = this.scale;
    const fwd = this.camera.getWorldDirection(v1);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = v2.set(-fwd.z, 0, fwd.x);
    const speed = (this.mode === 'fly' ? (c.boost ? SPEED.flyBoost : SPEED.fly) : c.boost ? SPEED.run : SPEED.walk) * s;
    const dx = (fwd.x * c.moveY + right.x * c.moveX) * speed * dt;
    const dz = (fwd.z * c.moveY + right.z * c.moveX) * speed * dt;
    this.moveHorizontal(dx, dz);

    const p = this.rig.position;
    if (this.mode === 'fly') {
      p.y += c.vertical * SPEED.vertical * s * (c.boost ? 4 : 1) * dt;
      const min = (this.giant ? this.ground.terrain(p.x, -p.z) : this.ground.top(p.x, -p.z)) + 0.05;
      if (p.y < min) p.y = min;
    } else {
      // 걷기: 딛을 수 있는 면으로 떨어지거나 계단 높이만큼 올라선다
      const floor = this.giant ? this.ground.terrain(p.x, -p.z) : this.ground.floor(p.x, -p.z, p.y);
      if (p.y > floor + 0.02) {
        this.vy -= GRAVITY * s * dt;
        p.y = Math.max(floor, p.y + this.vy * dt);
      } else {
        p.y = floor;
        this.vy = 0;
      }
    }

    this.updateTeleport(c.teleportAim && this.mode === 'walk', aimRay);
  }

  private rotateAroundHead(angle: number): void {
    const head = this.head(v1);
    const p = this.rig.position;
    const ox = p.x - head.x;
    const oz = p.z - head.z;
    const cs = Math.cos(angle);
    const sn = Math.sin(angle);
    p.x = head.x + ox * cs + oz * sn;
    p.z = head.z - ox * sn + oz * cs;
    this.rig.rotation.y += angle;
  }

  /** 건물 벽에 막히면 축별로 미끄러진다. 비행 중이거나 거인이면 지붕 위로는 자유. */
  private moveHorizontal(dx: number, dz: number): void {
    if (!dx && !dz) return;
    const p = this.rig.position;
    if (this.giant) {
      p.x += dx;
      p.z += dz;
      return;
    }
    const feet = p.y;
    const free = (x: number, z: number): boolean => !this.ground.blocked(x, -z, feet);
    if (free(p.x + dx, p.z + dz)) {
      p.x += dx;
      p.z += dz;
    } else if (free(p.x + dx, p.z)) p.x += dx;
    else if (free(p.x, p.z + dz)) p.z += dz;
  }

  private updateTeleport(aiming: boolean, ray: THREE.Object3D | null): void {
    if (aiming && ray) {
      this.teleportTarget = this.traceArc(ray);
      this.arc.visible = true;
      this.marker.visible = this.teleportTarget !== null;
      if (this.teleportTarget) {
        this.marker.position.copy(this.teleportTarget).add(v1.set(0, 0.05 * this.scale, 0));
        this.marker.scale.setScalar(this.scale);
      }
    } else {
      if (this.wasAiming && this.teleportTarget) {
        const t = this.teleportTarget;
        const yawDeg = -THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y);
        this.placeAt(t.x, -t.z, t.y, yawDeg);
      }
      this.arc.visible = false;
      this.marker.visible = false;
      this.teleportTarget = null;
    }
    this.wasAiming = aiming && ray !== null;
  }

  /** 포물선을 따라가며 지면/옥상과 만나는 점을 찾는다. */
  private traceArc(ray: THREE.Object3D): THREE.Vector3 | null {
    const s = this.scale;
    const pos = ray.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(ray.getWorldQuaternion(new THREE.Quaternion()));
    const vel = dir.multiplyScalar(14 * s);
    const attr = this.arc.geometry.getAttribute('position') as THREE.BufferAttribute;
    const dt = 0.06;
    let hit: THREE.Vector3 | null = null;
    let n = 0;
    const p = pos.clone();
    for (; n < 64; n++) {
      attr.setXYZ(n, p.x, p.y, p.z);
      const top = this.ground.top(p.x, -p.z);
      if (n > 0 && p.y <= top) {
        hit = new THREE.Vector3(p.x, top, p.z);
        n++;
        break;
      }
      p.addScaledVector(vel, dt);
      vel.y -= GRAVITY * s * dt;
    }
    for (let k = n; k < 64; k++) attr.setXYZ(k, p.x, p.y, p.z);
    attr.needsUpdate = true;
    this.arc.geometry.setDrawRange(0, n);
    return hit;
  }
}
