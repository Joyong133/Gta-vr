import * as THREE from 'three';
import type { Settings } from '../config/settings';
import { tuning } from '../config/tuning';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { clamp } from '../core/math';
import type { Actions } from '../input/InputRouter';
import type { InteractionManager } from '../interaction/InteractionManager';
import type { Movers } from '../traffic/Movers';
import type { PlayerVehicle } from '../vehicles/PlayerVehicle';
import type { Obb2 } from '../world/geom2d';
import type { ComfortOverlay } from './ComfortOverlay';
import type { Locomotion } from './Locomotion';
import type { PlayerRig } from './PlayerRig';

export type PlayerMode = 'foot' | 'driving';

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const UP = new THREE.Vector3(0, 1, 0);

export interface PlayerControllerDeps {
  rig: PlayerRig;
  overlay: ComfortOverlay;
  locomotion: Locomotion;
  interaction: InteractionManager;
  vehicle: PlayerVehicle;
  movers: Movers;
  bus: EventBus<GameEvents>;
  settings: () => Settings;
  isXR: () => boolean;
  onHorn: (on: boolean) => void;
}

/**
 * Owns the player's high-level state: walking or driving. Handles entering
 * (door opens -> short fade -> seated, facing forward), driving input, the
 * horizon-locked seat, safe exits, recovery and recentring.
 */
export class PlayerController {
  mode: PlayerMode = 'foot';
  busy = false;
  /** Head position in rig space captured when sitting down (keeps the head at the seat eye point). */
  private readonly seatCalib = new THREE.Vector3(0, tuning.player.eyeHeightDesktop, 0);
  private seatYawOffset = 0;
  private desktopCarLook = 0;
  private lastCarVel = new THREE.Vector3();
  private accelSmoothed = 0;
  private readonly carObbs: Obb2[] = [];

  constructor(private readonly d: PlayerControllerDeps) {}

  get driving(): boolean {
    return this.mode === 'driving';
  }

  /** Player position on the ground plane (car centre when driving). */
  position(out: THREE.Vector3): THREE.Vector3 {
    if (this.driving) return this.d.vehicle.worldPosition(out).setY(0);
    this.d.rig.headWorld(out);
    out.y = this.d.rig.rig.position.y;
    return out;
  }

  /** Near enough to the driver's door to get in? */
  nearCarDoor(): boolean {
    if (this.driving) return false;
    const v = this.d.vehicle;
    v.door.getAnchor(_p);
    this.d.rig.headWorld(_v);
    return Math.hypot(_p.x - _v.x, _p.z - _v.z) < 1.9 && v.physics.upY() > 0.5;
  }

  /** Context-sensitive prompt (desktop HUD / VR label / dashboard). */
  prompt(xr: boolean): string | null {
    const btnA = xr ? 'A' : 'E';
    const btnR = xr ? 'X' : 'R';
    if (this.busy) return null;
    if (this.driving) {
      const p = this.d.vehicle.physics;
      if (p.isFlipped) return `차량 전복 — [${btnR}] 복구`;
      if (p.isStuck) return `끼임 감지 — [${btnR}] 도로로 복구`;
      if (this.d.vehicle.speed < tuning.vehicle.exitMaxSpeed) return `[${btnA}] 하차`;
      return null;
    }
    if (this.nearCarDoor()) return this.d.vehicle.door.isOpen ? `[${btnA}] 운전석 탑승` : `[${btnA}] 문 열고 탑승`;
    return null;
  }

  update(dt: number, a: Actions): void {
    const xr = this.d.isXR();
    if (this.busy) {
      // Hold the car on the handbrake during fades. brake > 0.05 would mean
      // reverse once the car is slow; an empty car is parked (physics.enabled).
      const c = this.d.vehicle.physics.controls;
      c.throttle = 0;
      c.brake = 0;
      c.handbrake = this.driving;
      return;
    }
    if (this.mode === 'foot') {
      this.d.locomotion.update(dt, a, this.d.settings(), xr);
      if (a.interact && this.nearCarDoor()) void this.enterVehicle();
      return;
    }
    // ---- driving
    const v = this.d.vehicle;
    const c = v.physics.controls;
    const wheel = this.d.settings().comfort.wheelGrabSteering ? v.wheelGrab.steerInput : null;
    c.throttle = a.throttle;
    c.brake = a.brake;
    c.steer = wheel ?? a.steer;
    c.handbrake = a.handbrake;
    this.d.onHorn(a.horn);
    if (!xr) {
      this.desktopCarLook = clamp(this.desktopCarLook - a.lookX, -2.4, 2.4);
      if (Math.abs(a.lookX) < 1e-6 && a.throttle > 0) this.desktopCarLook *= Math.exp(-dt * 1.5);
      this.d.rig.applyDesktopLook(0, a.lookY);
    }
    if (a.interact) void this.exitVehicle();
    else if (a.recover) void this.recoverVehicle();
    else if (a.recenter) this.recenter();

    // Comfort: vignette from artificial rotation / acceleration of the car.
    const body = v.body;
    _v.set(body.velocity.x, body.velocity.y, body.velocity.z);
    const accel = _v.distanceTo(this.lastCarVel) / Math.max(dt, 1e-3);
    this.lastCarVel.copy(_v);
    this.accelSmoothed += (accel - this.accelSmoothed) * Math.min(1, dt * 6);
    const yawRate = Math.abs(body.angularVelocity.y);
    this.d.overlay.setMotion(Math.min(1, yawRate / 1.4) * 0.8 + Math.min(1, this.accelSmoothed / 12) * 0.5);
    this.d.overlay.setWallPenetration(0);
  }

  /** Called after physics each frame while driving: glue the rig to the seat. */
  applySeat(): void {
    if (!this.driving) return;
    const lock = this.d.settings().comfort.horizonLockInVehicle;
    this.d.vehicle.seatPose(lock, _p, _q);
    _q2.setFromAxisAngle(UP, this.seatYawOffset + this.desktopCarLook);
    _q.multiply(_q2);
    const rig = this.d.rig.rig;
    rig.quaternion.copy(_q);
    _v.copy(this.seatCalib).applyQuaternion(_q);
    rig.position.copy(_p).sub(_v);
    rig.updateMatrixWorld(true);
  }

  /** Re-captures the seat calibration from the current head pose (recenter). */
  recenter(): void {
    const rig = this.d.rig;
    if (this.d.isXR()) {
      rig.headLocalInRig(this.seatCalib);
      _e.setFromQuaternion(rig.camera.quaternion, 'YXZ');
      this.seatYawOffset = -_e.y;
    } else {
      this.seatCalib.set(0, tuning.player.eyeHeightDesktop, 0);
      this.seatYawOffset = 0;
      this.desktopCarLook = 0;
      rig.resetDesktopPitch();
    }
    this.applySeat();
  }

  async enterVehicle(): Promise<void> {
    if (this.busy || this.driving) return;
    const v = this.d.vehicle;
    this.busy = true;
    try {
      if (!v.door.isOpen) {
        v.door.open();
        await this.waitFor(() => v.door.angle < -0.8, 0.8);
      }
      await this.d.overlay.fadeOut(0.2);
      // Mission items ride along on the passenger seat; anything else is dropped.
      for (const h of this.d.interaction.hands) {
        const item = h.held;
        if (!item) continue;
        if (item.tags.has('mission') && !v.passengerSocket.item) {
          this.d.interaction.releaseHand(h, true);
          if (item.primary === null) v.passengerSocket.insert(item);
        } else this.d.interaction.releaseHand(h, true);
      }
      this.mode = 'driving';
      v.occupied = true;
      v.physics.enabled = true;
      v.wheelGrab.enabled = this.d.settings().comfort.wheelGrabSteering;
      this.d.locomotion.enabled = false;
      this.desktopCarLook = 0;
      this.recenter();
      v.door.close();
      this.lastCarVel.set(0, 0, 0);
      this.d.bus.emit('vehicle:enter', { vehicleId: v.id });
      await this.d.overlay.fadeIn(0.25);
    } finally {
      this.busy = false;
    }
  }

  async exitVehicle(force = false): Promise<boolean> {
    if (this.busy || !this.driving) return false;
    const v = this.d.vehicle;
    if (!force && v.speed > tuning.vehicle.exitMaxSpeed) {
      this.d.bus.emit('toast', { text: '차를 세운 뒤 하차하세요', kind: 'warn', duration: 2 });
      return false;
    }
    this.busy = true;
    try {
      v.door.open();
      await this.d.overlay.fadeOut(0.2);
      this.d.movers.carObbs(v.id, this.carObbs);
      const spot = new THREE.Vector3();
      v.findExitSpot(this.carObbs, spot);
      this.placeOnFoot(spot.x, spot.z, v.physics.yaw() + this.seatYawOffset + this.desktopCarLook);
      this.d.bus.emit('vehicle:exit', { vehicleId: v.id });
      await this.d.overlay.fadeIn(0.25);
      setTimeout(() => v.door.close(), 600);
    } finally {
      this.busy = false;
    }
    return true;
  }

  private placeOnFoot(x: number, z: number, worldYaw: number): void {
    const v = this.d.vehicle;
    this.mode = 'foot';
    v.occupied = false;
    // Park the empty car: brakes on, wheels straight, never reverses. Stale
    // driver input is cleared so nothing carries over to the next drive.
    const c = v.physics.controls;
    c.throttle = 0;
    c.brake = 0;
    c.steer = 0;
    c.handbrake = false;
    v.physics.enabled = false;
    v.wheelGrab.releaseAll();
    v.wheelGrab.enabled = false;
    this.d.onHorn(false);
    const rig = this.d.rig;
    rig.rig.quaternion.setFromAxisAngle(UP, worldYaw);
    rig.rig.position.y = 0;
    rig.resetDesktopPitch();
    rig.syncHeadMatrices();
    rig.placeHeadAt(x, z, 0);
    this.d.locomotion.enabled = true;
    this.d.locomotion.warp(x, z);
  }

  /** Flip / stuck recovery (or "call car" while driving): fade, put the car on the road. */
  async recoverVehicle(): Promise<void> {
    if (this.busy) return;
    const v = this.d.vehicle;
    const p = v.physics;
    if (!p.isFlipped && !p.isStuck && v.speed > 4) return;
    this.busy = true;
    try {
      if (this.driving) await this.d.overlay.fadeOut(0.2);
      this.d.movers.carObbs(v.id, this.carObbs);
      v.recover(this.carObbs);
      if (this.driving) {
        // Let the suspension settle while the screen is still black so the
        // seated player never sees the car drop or bounce.
        await this.waitFor(() => p.vehicle.numWheelsOnGround === 4 && Math.abs(v.body.velocity.y) < 0.15, 0.8);
        this.applySeat();
        await this.d.overlay.fadeIn(0.3);
      }
      this.d.bus.emit('toast', { text: '차량을 도로 위로 복구했습니다', kind: 'info', duration: 2 });
    } finally {
      this.busy = false;
    }
  }

  /**
   * Respawn / teleport with fade (busted, menu "safe spot", load). Leaves the car where it is.
   * Held items are dropped unless keepItems (QA teleports).
   */
  async warpTo(x: number, z: number, yaw: number, keepItems = false): Promise<void> {
    this.busy = true;
    try {
      await this.d.overlay.fadeOut(0.25);
      if (!keepItems) this.d.interaction.releaseAll();
      if (this.driving) this.d.bus.emit('vehicle:exit', { vehicleId: this.d.vehicle.id });
      this.placeOnFoot(x, z, 0);
      this.d.rig.spawnAt(x, z, 0, yaw);
      this.d.locomotion.warp(x, z);
      await this.d.overlay.fadeIn(0.35);
    } finally {
      this.busy = false;
    }
  }

  private waitFor(cond: () => boolean, timeout: number): Promise<void> {
    const start = performance.now();
    return new Promise((resolve) => {
      const tick = (): void => {
        if (cond() || performance.now() - start > timeout * 1000) resolve();
        else setTimeout(tick, 30);
      };
      tick();
    });
  }
}
