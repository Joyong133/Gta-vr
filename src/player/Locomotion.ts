import * as THREE from 'three';
import type { Settings } from '../config/settings';
import { tuning } from '../config/tuning';
import { DEG2RAD } from '../core/math';
import type { Actions } from '../input/InputRouter';
import { circleVsObb, type Obb2 } from '../world/geom2d';
import type { StaticWorld } from '../world/StaticWorld';
import type { ComfortOverlay } from './ComfortOverlay';
import type { PlayerRig } from './PlayerRig';
import type { Teleport } from './Teleport';

const _head = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _push = { x: 0, z: 0 };
const _target = { x: 0, z: 0 };
const _probe = { x: 0, z: 0 };

export interface LocomotionContext {
  /** Moving obstacles the player cannot walk through (parked car, AI cars, closed doors). */
  obstacles: () => readonly Obb2[];
  /** Pose used for hand-relative movement and teleport aiming (XR: dominant controller ray). */
  aimPose: () => THREE.Object3D | null;
  /** Pose used for hand-relative move direction (XR: off-hand controller). */
  movePose: () => THREE.Object3D | null;
  onStep: (pos: THREE.Vector3) => void;
  onTeleport: (pos: THREE.Vector3) => void;
}

/**
 * On-foot movement: smooth locomotion, snap/smooth turning and teleport.
 * Collision is resolved for the head's footprint against StaticWorld boxes and
 * dynamic obstacle footprints; real (physical) head motion is never pushed back,
 * the view darkens instead when the head enters a wall.
 */
export class Locomotion {
  enabled = true;
  private busy = false;
  private stepAccum = 0;
  private readonly lastHead = new THREE.Vector3();
  /** Artificial speed this frame (m/s), used for vignette + footsteps. */
  speed = 0;
  private turnRate = 0;

  constructor(
    private readonly rig: PlayerRig,
    private readonly world: StaticWorld,
    private readonly teleport: Teleport,
    private readonly overlay: ComfortOverlay,
    private readonly ctx: LocomotionContext,
  ) {}

  update(dt: number, a: Actions, settings: Settings, xr: boolean): void {
    const c = settings.comfort;
    this.speed = 0;
    this.turnRate = 0;
    if (!this.enabled || this.busy) {
      this.teleport.hide();
      this.overlay.setMotion(0);
      return;
    }
    this.rig.headWorld(_head);

    // --- Turning
    if (xr) {
      if (c.turnMode === 'snap') {
        if (a.snapTurn !== 0) this.rig.rotateAroundHead(-a.snapTurn * c.snapAngle * DEG2RAD);
      } else if (a.turn !== 0) {
        const rate = -a.turn * c.smoothTurnSpeed * DEG2RAD;
        this.rig.rotateAroundHead(rate * dt);
        this.turnRate = Math.abs(rate);
      }
    } else {
      if (a.lookX !== 0 || a.lookY !== 0) this.rig.applyDesktopLook(a.lookX, a.lookY);
      if (a.snapTurn !== 0) this.rig.rotateAroundHead(-a.snapTurn * c.snapAngle * DEG2RAD);
    }

    // --- Smooth locomotion
    const allowSmooth = c.locomotion !== 'teleport' || !xr;
    const mx = a.move.x;
    const my = a.move.y;
    if (allowSmooth && (mx !== 0 || my !== 0)) {
      let yaw: number;
      const mp = c.moveDirection === 'hand' && xr ? this.ctx.movePose() : null;
      if (mp) {
        mp.getWorldDirection(_dir); // object -Z is forward for XR target-ray spaces; getWorldDirection returns +Z
        yaw = Math.atan2(_dir.x, _dir.z);
      } else {
        yaw = this.rig.headYaw();
      }
      const run = a.run ? 1.6 : 1;
      const speed = c.moveSpeed * run;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      // forward = (-sin, -cos), right = (cos, -sin)
      const vx = (-sin * my + cos * mx) * speed;
      const vz = (-cos * my - sin * mx) * speed;
      const target = _target;
      target.x = _head.x + vx * dt;
      target.z = _head.z + vz * dt;
      this.resolve(target, _head.y - this.rig.rig.position.y);
      this.rig.translate(target.x - _head.x, target.z - _head.z);
      this.speed = Math.hypot(target.x - _head.x, target.z - _head.z) / Math.max(dt, 1e-4);
    }

    // --- Teleport (XR: dominant stick forward; desktop: hold T)
    const allowTeleport = !xr || c.locomotion !== 'smooth';
    if (allowTeleport && a.teleportAim) {
      const pose = xr ? this.ctx.aimPose() : null;
      if (pose) {
        pose.getWorldPosition(_origin);
        pose.getWorldDirection(_dir).negate(); // target ray points along -Z
      } else {
        this.rig.camera.getWorldPosition(_origin);
        this.rig.camera.getWorldDirection(_dir);
        _origin.y -= 0.3;
      }
      this.rig.headWorld(_head);
      this.teleport.update(_origin, _dir, this.rig.rig.position.y, _head);
    } else if (a.teleportConfirm && this.teleport.active && this.teleport.valid) {
      const t = this.teleport.target.clone();
      this.teleport.hide();
      void this.doTeleport(t);
    } else {
      this.teleport.hide();
    }

    // --- Footsteps (artificial + physical walking)
    this.rig.headWorld(_head);
    const moved = Math.hypot(_head.x - this.lastHead.x, _head.z - this.lastHead.z);
    if (moved < 2) {
      this.stepAccum += moved;
      if (this.stepAccum > 0.75) {
        this.stepAccum = 0;
        this.ctx.onStep(_head);
      }
    }
    this.lastHead.copy(_head);

    // --- Head-in-wall darkening (physical leaning into geometry)
    const probe = _probe;
    probe.x = _head.x;
    probe.z = _head.z;
    const radius = 0.12;
    let depth = 0;
    if (this.world.isCircleBlocked(probe.x, probe.z, radius, this.rig.rig.position.y)) {
      this.world.resolveCircle(probe, radius, this.rig.rig.position.y);
      depth = Math.hypot(probe.x - _head.x, probe.z - _head.z);
    }
    this.overlay.setWallPenetration(depth / tuning.player.headInWallFadeDepth);

    const motion = Math.min(1, this.speed / 3.5) + Math.min(1, this.turnRate / 2.5);
    this.overlay.setMotion(motion);
  }

  private resolve(target: { x: number; z: number }, _headHeight: number): void {
    const r = tuning.player.bodyRadius;
    const feet = this.rig.rig.position.y;
    for (let i = 0; i < 2; i++) {
      this.world.resolveCircle(target, r, feet);
      for (const o of this.ctx.obstacles()) {
        if (circleVsObb(target.x, target.z, r, o, _push)) {
          target.x += _push.x;
          target.z += _push.z;
        }
      }
    }
  }

  private async doTeleport(target: THREE.Vector3): Promise<void> {
    this.busy = true;
    await this.overlay.fadeOut(0.12);
    this.rig.placeHeadAt(target.x, target.z, this.rig.rig.position.y);
    this.ctx.onTeleport(target);
    this.rig.headWorld(this.lastHead);
    await this.overlay.fadeIn(0.18);
    this.busy = false;
  }

  /** Instant teleport used by respawns and debug tools (caller handles fades). */
  warp(x: number, z: number, yaw?: number): void {
    if (yaw !== undefined) this.rig.spawnAt(x, z, 0, yaw);
    else this.rig.placeHeadAt(x, z, 0);
    this.rig.headWorld(this.lastHead);
    this.teleport.hide();
  }
}
