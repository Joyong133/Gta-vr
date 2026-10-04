import * as CANNON from 'cannon-es';
import type * as THREE from 'three';
import { COL, MASK } from '../config/layers';
import { bodyTags, type BodyKind } from '../core/events';
import { wrapAngle } from '../core/math';
import { buildCarModel, type CarKind, type CarVisual } from '../vehicles/CarModel';
import type { Obb2 } from '../world/geom2d';

/**
 * Kinematic AI car (traffic / police). Gameplay code decides a target pose
 * every physics step; the kinematic body gets the velocity needed to reach it
 * so the dynamic player car collides with it correctly. Visuals follow the
 * interpolated body, so motion is smooth at any display rate.
 */
export class AICar {
  readonly visual: CarVisual;
  readonly body: CANNON.Body;
  x = 0;
  z = 0;
  yaw = 0;
  speed = 0;
  readonly obb: Obb2 = { cx: 0, cz: 0, yaw: 0, halfW: 0.95, halfL: 2.25 };
  /** Visual wheel spin accumulator. */
  private spin = 0;
  active = true;
  /** Short impulse knock from a collision (fake reaction on a kinematic body). */
  knockX = 0;
  knockZ = 0;
  knockYaw = 0;

  constructor(
    scene: THREE.Scene,
    world: CANNON.World,
    readonly id: string,
    readonly kind: CarKind,
    color: THREE.ColorRepresentation,
  ) {
    this.visual = buildCarModel(kind, color);
    scene.add(this.visual.root);
    this.body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      collisionFilterGroup: COL.AI_CAR,
      collisionFilterMask: MASK.AI_CAR,
    });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(0.92, 0.45, 2.2)), new CANNON.Vec3(0, 0.2, 0));
    world.addBody(this.body);
    bodyTags.set(this.body, { kind: kind as BodyKind, id });
  }

  /** Teleports (no interpolation smear). */
  setPose(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    const b = this.body;
    b.position.set(x, 0.41, z);
    b.quaternion.setFromEuler(0, yaw, 0);
    b.velocity.setZero();
    b.angularVelocity.setZero();
    b.previousPosition.copy(b.position);
    b.interpolatedPosition.copy(b.position);
    b.previousQuaternion.copy(b.quaternion);
    b.interpolatedQuaternion.copy(b.quaternion);
    this.updateObb();
  }

  /**
   * Called inside a fixed step after the brain computed (x, z, yaw) for the END
   * of this step: sets body velocities so cannon integrates exactly there.
   */
  commitStep(h: number): void {
    // Decay knock reaction
    if (this.knockX !== 0 || this.knockZ !== 0 || this.knockYaw !== 0) {
      this.x += this.knockX * h;
      this.z += this.knockZ * h;
      this.yaw += this.knockYaw * h;
      const f = Math.exp(-4 * h);
      this.knockX *= f;
      this.knockZ *= f;
      this.knockYaw *= f;
      if (Math.abs(this.knockX) + Math.abs(this.knockZ) < 0.05) {
        this.knockX = 0;
        this.knockZ = 0;
      }
      if (Math.abs(this.knockYaw) < 0.02) this.knockYaw = 0;
    }
    const b = this.body;
    b.velocity.set((this.x - b.position.x) / h, 0, (this.z - b.position.z) / h);
    // Current yaw of the body
    const q = b.quaternion;
    const curYaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    b.angularVelocity.set(0, wrapAngle(this.yaw - curYaw) / h, 0);
    b.position.y = 0.41;
    this.updateObb();
  }

  knock(vx: number, vz: number, spin: number): void {
    this.knockX += vx;
    this.knockZ += vz;
    this.knockYaw += spin;
  }

  private updateObb(): void {
    this.obb.cx = this.x;
    this.obb.cz = this.z;
    this.obb.yaw = this.yaw;
  }

  /** Per-render-frame visual sync. */
  syncVisual(dt: number): void {
    const b = this.body;
    const root = this.visual.root;
    root.position.set(b.interpolatedPosition.x, b.interpolatedPosition.y, b.interpolatedPosition.z);
    root.quaternion.set(b.interpolatedQuaternion.x, b.interpolatedQuaternion.y, b.interpolatedQuaternion.z, b.interpolatedQuaternion.w);
    this.spin -= (this.speed / 0.36) * dt;
    for (const s of this.visual.wheelSpins) s.rotation.x = this.spin;
  }

  setVisible(v: boolean): void {
    this.visual.root.visible = v;
  }

  setBraking(on: boolean): void {
    this.visual.tailMat.color.setHex(on ? 0xff1a2e : 0x8a0f1a);
  }

  forward(out: { x: number; z: number }): { x: number; z: number } {
    out.x = -Math.sin(this.yaw);
    out.z = -Math.cos(this.yaw);
    return out;
  }
}
