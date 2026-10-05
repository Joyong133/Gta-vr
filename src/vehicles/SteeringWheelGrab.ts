import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Draggable } from '../interaction/Door';
import { Interactable } from '../interaction/Interactable';
import type { InteractorHand } from '../interaction/InteractorHand';

const _p = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const MAX_WHEEL_ANGLE = 2.4; // rad of wheel rotation for full lock
/** Hands closer than this to the wheel axis (m, in the wheel plane) are ignored: atan2 is noise there. */
const MIN_HAND_RADIUS = 0.06;

interface Holder {
  hand: InteractorHand;
  /** Hand angle last frame (NaN = not tracked, re-seed on next sample). */
  last: number;
  /** Unwrapped rotation this hand has applied since the grab (rad). */
  acc: number;
}

/**
 * Optional virtual steering wheel. Grip it with one or two hands and turn.
 * Stick steering always keeps working: this only overrides while held.
 */
export class SteeringWheelGrab extends Interactable implements Draggable {
  private readonly holders: Holder[] = [];
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
    return this.holders.length > 0;
  }

  /** -1..1 steering input while held (positive = right), else null. */
  get steerInput(): number | null {
    if (!this.held) return null;
    return clamp(-this.wheelAngle / MAX_WHEEL_ANGLE, -1, 1);
  }

  /** Hand angle in the wheel plane, or null when the hand is too close to the axis. */
  private handAngle(hand: InteractorHand): number | null {
    this.mount.updateWorldMatrix(true, false);
    _inv.copy(this.mount.matrixWorld).invert();
    hand.touchPoint(_p).applyMatrix4(_inv);
    if (_p.x * _p.x + _p.y * _p.y < MIN_HAND_RADIUS * MIN_HAND_RADIUS) return null;
    return Math.atan2(_p.y, _p.x);
  }

  private indexOf(hand: InteractorHand): number {
    for (let i = 0; i < this.holders.length; i++) if (this.holders[i].hand === hand) return i;
    return -1;
  }

  /** Restarts every hand's tracking from the current wheel angle. */
  private reseed(): void {
    this.baseAngle = this.wheelAngle;
    for (const s of this.holders) {
      s.last = this.handAngle(s.hand) ?? NaN;
      s.acc = 0;
    }
  }

  beginDrag(hand: InteractorHand): void {
    if (this.indexOf(hand) < 0) this.holders.push({ hand, last: NaN, acc: 0 });
    this.reseed();
    hand.pulse(0.3, 30);
  }

  updateDrag(hand: InteractorHand): void {
    if (this.indexOf(hand) < 0) return;
    // Average the unwrapped (frame-to-frame) rotation of all holding hands, so
    // turning a hand past 180 deg never wraps to the opposite lock. Each hand is
    // clamped at the stops so reversing direction responds immediately.
    const lo = -MAX_WHEEL_ANGLE - this.baseAngle;
    const hi = MAX_WHEEL_ANGLE - this.baseAngle;
    let sum = 0;
    for (let i = 0; i < this.holders.length; i++) {
      const s = this.holders[i];
      const a = this.handAngle(s.hand);
      if (a === null) {
        s.last = NaN; // near the hub: freeze this hand's contribution
      } else {
        if (!Number.isNaN(s.last)) {
          let d = a - s.last;
          if (d > Math.PI) d -= Math.PI * 2;
          else if (d < -Math.PI) d += Math.PI * 2;
          s.acc = clamp(s.acc + d, lo, hi);
        }
        s.last = a;
      }
      sum += s.acc;
    }
    this.wheelAngle = clamp(this.baseAngle + sum / this.holders.length, -MAX_WHEEL_ANGLE, MAX_WHEEL_ANGLE);
  }

  endDrag(hand: InteractorHand): void {
    const i = this.indexOf(hand);
    if (i >= 0) this.holders.splice(i, 1);
    this.reseed();
  }

  /** Called when not held: the wheel follows the physical steering angle. */
  follow(steerAngle: number, maxSteer: number): void {
    if (this.held) return;
    // Physics steering is positive to the left, as is a counter-clockwise wheel.
    this.wheelAngle = (steerAngle / Math.max(0.01, maxSteer)) * MAX_WHEEL_ANGLE * 0.85;
  }

  releaseAll(): void {
    this.holders.length = 0;
    this.baseAngle = this.wheelAngle;
  }
}
