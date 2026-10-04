import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Draggable } from '../interaction/Door';
import { Interactable } from '../interaction/Interactable';
import type { InteractorHand } from '../interaction/InteractorHand';

const _p = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const MAX_WHEEL_ANGLE = 2.4; // rad of wheel rotation for full lock

/**
 * Optional virtual steering wheel. Grip it with one or two hands and turn.
 * Stick steering always keeps working: this only overrides while held.
 */
export class SteeringWheelGrab extends Interactable implements Draggable {
  private readonly holders = new Map<InteractorHand, number>();
  private baseAngle = 0;
  wheelAngle = 0;

  constructor(private readonly mount: THREE.Object3D) {
    super('steering_wheel', 'generic', mount);
    this.farSelectable = false;
    this.nearRadius = 0.22;
    this.verb = '핸들 잡기';
    this.enabled = false;
  }

  get held(): boolean {
    return this.holders.size > 0;
  }

  /** -1..1 steering input while held (positive = right), else null. */
  get steerInput(): number | null {
    if (!this.held) return null;
    return clamp(-this.wheelAngle / MAX_WHEEL_ANGLE, -1, 1);
  }

  private handAngle(hand: InteractorHand): number {
    this.mount.updateWorldMatrix(true, false);
    _inv.copy(this.mount.matrixWorld).invert();
    hand.touchPoint(_p).applyMatrix4(_inv);
    return Math.atan2(_p.y, _p.x);
  }

  beginDrag(hand: InteractorHand): void {
    this.holders.set(hand, this.handAngle(hand));
    this.baseAngle = this.wheelAngle;
    for (const [h] of this.holders) this.holders.set(h, this.handAngle(h));
    hand.pulse(0.3, 30);
  }

  updateDrag(hand: InteractorHand): void {
    const start = this.holders.get(hand);
    if (start === undefined) return;
    // Average angular change of all holding hands since the grab.
    let sum = 0;
    let n = 0;
    for (const [h, a0] of this.holders) {
      let d = this.handAngle(h) - a0;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      sum += d;
      n++;
    }
    if (n) this.wheelAngle = clamp(this.baseAngle + sum / n, -MAX_WHEEL_ANGLE, MAX_WHEEL_ANGLE);
  }

  endDrag(hand: InteractorHand): void {
    this.holders.delete(hand);
    this.baseAngle = this.wheelAngle;
    for (const [h] of this.holders) this.holders.set(h, this.handAngle(h));
  }

  /** Called when not held: the wheel follows the physical steering angle. */
  follow(steerAngle: number, maxSteer: number): void {
    if (this.held) return;
    // Physics steering is positive to the left, as is a counter-clockwise wheel.
    this.wheelAngle = (steerAngle / Math.max(0.01, maxSteer)) * MAX_WHEEL_ANGLE * 0.85;
  }

  releaseAll(): void {
    this.holders.clear();
    this.baseAngle = this.wheelAngle;
  }
}
