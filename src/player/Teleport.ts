import * as THREE from 'three';
import { tuning } from '../config/tuning';
import type { StaticWorld } from '../world/StaticWorld';

const SEGMENTS = 40;
const _p = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _vel = new THREE.Vector3();

/**
 * Parabolic teleport arc. Valid targets are on the ground (y = 0, including
 * interiors), free of walk-blocking geometry and within max distance.
 * Additional blockers (cars, doors) are supplied by `isBlockedExtra`.
 */
export class Teleport {
  readonly group = new THREE.Group();
  private readonly line: THREE.Line;
  private readonly positions: Float32Array;
  private readonly reticle: THREE.Mesh;
  private readonly lineMat: THREE.LineBasicMaterial;
  private readonly reticleMat: THREE.MeshBasicMaterial;
  readonly target = new THREE.Vector3();
  valid = false;
  active = false;

  constructor(
    scene: THREE.Scene,
    private readonly world: StaticWorld,
    private readonly isBlockedExtra: (x: number, z: number) => boolean = () => false,
  ) {
    this.positions = new Float32Array((SEGMENTS + 1) * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.lineMat = new THREE.LineBasicMaterial({ color: 0x3df5ff, transparent: true, opacity: 0.9, depthWrite: false });
    this.line = new THREE.Line(geo, this.lineMat);
    this.line.frustumCulled = false;
    const ring = new THREE.RingGeometry(0.22, 0.3, 32);
    ring.rotateX(-Math.PI / 2);
    this.reticleMat = new THREE.MeshBasicMaterial({ color: 0x3df5ff, transparent: true, opacity: 0.85, depthWrite: false });
    this.reticle = new THREE.Mesh(ring, this.reticleMat);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 3), this.reticleMat);
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(0, 0.01, -0.36);
    this.reticle.add(arrow);
    this.group.add(this.line, this.reticle);
    this.group.visible = false;
    this.group.name = 'TeleportArc';
    scene.add(this.group);
  }

  /** Recomputes the arc from a controller ray. */
  update(origin: THREE.Vector3, direction: THREE.Vector3, feetY: number, playerPos: THREE.Vector3): void {
    this.active = true;
    this.group.visible = true;
    const speed = tuning.player.teleportArcSpeed;
    const g = 9.8;
    _vel.copy(direction).normalize().multiplyScalar(speed);
    _prev.copy(origin);
    let hit = false;
    let count = 0;
    const dt = 0.05;
    this.positions[0] = origin.x;
    this.positions[1] = origin.y;
    this.positions[2] = origin.z;
    count = 1;
    for (let i = 1; i <= SEGMENTS; i++) {
      const t = i * dt;
      _p.set(origin.x + _vel.x * t, origin.y + _vel.y * t - 0.5 * g * t * t, origin.z + _vel.z * t);
      // Wall in the way?
      const dx = _p.x - _prev.x;
      const dy = _p.y - _prev.y;
      const dz = _p.z - _prev.z;
      const len = Math.hypot(dx, dy, dz);
      const wall = len > 0 ? this.world.raycast(_prev.x, _prev.y, _prev.z, dx / len, dy / len, dz / len, len) : null;
      if (wall) {
        // Hit geometry (wall, roof, counter): the arc stops there and is invalid.
        _p.set(_prev.x + (dx / len) * wall.t, _prev.y + (dy / len) * wall.t, _prev.z + (dz / len) * wall.t);
        this.writePoint(count++, _p);
        this.target.copy(_p);
        hit = false;
        break;
      }
      if (_p.y <= feetY) {
        // Interpolate exact ground crossing.
        const f = (_prev.y - feetY) / Math.max(1e-6, _prev.y - _p.y);
        _p.set(_prev.x + dx * f, feetY, _prev.z + dz * f);
        this.writePoint(count++, _p);
        this.target.copy(_p);
        hit = true;
        break;
      }
      this.writePoint(count++, _p);
      _prev.copy(_p);
    }
    for (let i = count; i <= SEGMENTS; i++) {
      this.positions[i * 3] = this.positions[(count - 1) * 3];
      this.positions[i * 3 + 1] = this.positions[(count - 1) * 3 + 1];
      this.positions[i * 3 + 2] = this.positions[(count - 1) * 3 + 2];
    }
    (this.line.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.line.geometry.computeBoundingSphere();

    const r = tuning.player.bodyRadius;
    const flat = Math.hypot(this.target.x - playerPos.x, this.target.z - playerPos.z);
    this.valid =
      hit &&
      flat <= tuning.player.teleportMaxDistance &&
      Math.abs(this.target.x) < 146 &&
      Math.abs(this.target.z) < 146 &&
      !this.world.isCircleBlocked(this.target.x, this.target.z, r, feetY) &&
      !this.isBlockedExtra(this.target.x, this.target.z);
    const color = this.valid ? 0x3df5ff : 0xff3355;
    this.lineMat.color.setHex(color);
    this.reticleMat.color.setHex(color);
    this.reticle.visible = hit;
    this.reticle.position.copy(this.target).setY(feetY + 0.02);
    this.reticle.rotation.y = Math.atan2(-(this.target.x - playerPos.x), -(this.target.z - playerPos.z));
  }

  hide(): void {
    this.active = false;
    this.group.visible = false;
    this.valid = false;
  }

  private writePoint(i: number, p: THREE.Vector3): void {
    this.positions[i * 3] = p.x;
    this.positions[i * 3 + 1] = p.y;
    this.positions[i * 3 + 2] = p.z;
  }
}
