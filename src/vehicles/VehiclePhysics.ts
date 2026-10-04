import * as CANNON from 'cannon-es';
import { COL, MASK } from '../config/layers';
import { tuning } from '../config/tuning';
import { clamp, clamp01, moveToward } from '../core/math';

export interface VehicleControls {
  throttle: number; // 0..1
  brake: number; // 0..1 (brake, or reverse when stopped)
  steer: number; // -1..1, positive = right
  handbrake: boolean;
}

export const WHEEL_LAYOUT = {
  halfTrack: 0.8,
  frontZ: -1.36,
  rearZ: 1.34,
  connectionY: 0.2,
  radius: 0.36,
};

const _fwd = new CANNON.Vec3();
const _right = new CANNON.Vec3();
const _up = new CANNON.Vec3();
const _tmp = new CANNON.Vec3();
const _torque = new CANNON.Vec3();
const LOCAL_FWD = new CANNON.Vec3(0, 0, -1);
const LOCAL_RIGHT = new CANNON.Vec3(1, 0, 0);
const LOCAL_UP = new CANNON.Vec3(0, 1, 0);

/**
 * Player car physics: cannon-es RaycastVehicle (4 wheels, AWD) plus arcade
 * assists for predictable, VR-friendly handling: lateral grip assist, yaw
 * damping, speed-sensitive steering, downforce and an anti-roll torque.
 *
 * Conventions (verified empirically): local forward = -Z, positive engine force
 * drives forward, positive steering value turns left.
 */
export class VehiclePhysics {
  readonly chassis: CANNON.Body;
  readonly vehicle: CANNON.RaycastVehicle;
  readonly controls: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  steerAngle = 0;
  /** Signed speed along the car's forward axis (m/s). */
  forwardSpeed = 0;
  /** Seconds the car has been upside down / on its side. */
  flippedTime = 0;
  /** Seconds the driver has been pushing throttle without moving. */
  stuckTime = 0;
  enabled = true;
  private readonly t = tuning.vehicle;

  constructor(private readonly world: CANNON.World) {
    const t = this.t;
    this.chassis = new CANNON.Body({
      mass: t.mass,
      collisionFilterGroup: COL.PLAYER_CAR,
      collisionFilterMask: MASK.PLAYER_CAR,
      angularDamping: 0.35,
      linearDamping: 0.02,
      allowSleep: false,
    });
    // Box sits above the body origin so the centre of mass is low (stable).
    this.chassis.addShape(new CANNON.Box(new CANNON.Vec3(0.92, 0.3, 2.18)), new CANNON.Vec3(0, 0.09, 0));
    // Cabin (lighter collision volume for roof impacts / rollovers).
    this.chassis.addShape(new CANNON.Box(new CANNON.Vec3(0.78, 0.26, 1.15)), new CANNON.Vec3(0, 0.62, 0.15));
    this.chassis.position.set(0, 1, 0);

    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassis,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });
    const w = WHEEL_LAYOUT;
    const positions: [number, number][] = [
      [-w.halfTrack, w.frontZ],
      [w.halfTrack, w.frontZ],
      [-w.halfTrack, w.rearZ],
      [w.halfTrack, w.rearZ],
    ];
    for (const [x, z] of positions) {
      this.vehicle.addWheel({
        radius: w.radius,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        suspensionStiffness: t.suspensionStiffness,
        suspensionRestLength: t.suspensionRestLength,
        frictionSlip: t.frictionSlip,
        dampingRelaxation: 2.4,
        dampingCompression: 4.4,
        maxSuspensionForce: 1e6,
        rollInfluence: t.rollInfluence,
        axleLocal: new CANNON.Vec3(1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(x, w.connectionY, z),
        maxSuspensionTravel: 0.28,
        customSlidingRotationalSpeed: -30,
        useCustomSlidingRotationalSpeed: true,
      });
    }
    this.vehicle.addToWorld(world);
  }

  /** Physics step hook: applies driver controls + assists. Call from world preStep. */
  fixedUpdate(h: number): void {
    const t = this.t;
    const c = this.controls;
    const b = this.chassis;
    b.vectorToWorldFrame(LOCAL_FWD, _fwd);
    b.vectorToWorldFrame(LOCAL_RIGHT, _right);
    b.vectorToWorldFrame(LOCAL_UP, _up);
    const v = b.velocity;
    const speed = v.dot(_fwd);
    this.forwardSpeed = speed;
    const grounded = this.vehicle.numWheelsOnGround >= 2;

    let engine = 0;
    let brake = 0.6; // light rolling resistance
    if (!this.enabled) {
      brake = t.brakeForce * 0.5;
    } else if (c.brake > 0.05 && speed > 0.6) {
      brake = t.brakeForce * c.brake;
    } else if (c.brake > 0.05) {
      // Stopped (or rolling back): brake input becomes reverse.
      const rev = clamp01(1 - Math.max(0, -speed) / t.maxReverseSpeed);
      engine = -t.reverseForce * c.brake * rev;
      brake = 0;
    } else if (c.throttle > 0.05) {
      if (speed < -0.6) {
        brake = t.brakeForce * c.throttle;
      } else {
        const r = clamp01(speed / t.maxForwardSpeed);
        engine = t.engineForce * c.throttle * (1 - r * r);
        brake = 0;
      }
    }
    const front = engine * 0.4 * 0.5;
    const rear = engine * 0.6 * 0.5;
    this.vehicle.applyEngineForce(front, 0);
    this.vehicle.applyEngineForce(front, 1);
    this.vehicle.applyEngineForce(rear, 2);
    this.vehicle.applyEngineForce(rear, 3);
    this.vehicle.setBrake(brake, 0);
    this.vehicle.setBrake(brake, 1);
    const hb = this.enabled && c.handbrake ? t.handbrakeForce : 0;
    this.vehicle.setBrake(brake + hb, 2);
    this.vehicle.setBrake(brake + hb, 3);

    // Speed-sensitive steering with a slew limit (no twitchy snaps in VR).
    const sRatio = clamp01(Math.abs(speed) / t.steerSpeedRef);
    const maxSteer = t.maxSteerLowSpeed + (t.maxSteerHighSpeed - t.maxSteerLowSpeed) * sRatio;
    const target = -clamp(c.steer, -1, 1) * maxSteer * (this.enabled ? 1 : 0);
    this.steerAngle = moveToward(this.steerAngle, target, t.steerRate * h);
    this.vehicle.setSteeringValue(this.steerAngle, 0);
    this.vehicle.setSteeringValue(this.steerAngle, 1);

    if (grounded) {
      // Lateral grip assist: bleed sideways velocity (reduces unwanted slides/spins).
      const lateral = v.dot(_right);
      const k = Math.min(1, t.lateralGripAssist * h);
      _tmp.copy(_right).scale(-lateral * k, _tmp);
      v.vadd(_tmp, v);
      // Yaw damping when not steering hard.
      const av = b.angularVelocity;
      const yawRate = av.dot(_up);
      const damp = t.yawDampingAssist * (1 - Math.min(1, Math.abs(c.steer)) * 0.6) * h;
      _tmp.copy(_up).scale(-yawRate * damp, _tmp);
      av.vadd(_tmp, av);
      // Downforce keeps the car planted at speed.
      _tmp.copy(_up).scale(-t.downforce * speed * speed * b.mass * 0.01, _tmp);
      b.applyForce(_tmp);
    } else {
      // Airborne: gently damp spin so landings are less violent.
      b.angularVelocity.scale(1 - 0.8 * h, b.angularVelocity);
    }

    // Anti-roll: push the car back toward upright when tilted (but not when fully flipped).
    const rollAmount = _right.y; // >0 right side up
    if (_up.y > 0.2 && Math.abs(rollAmount) > 0.12) {
      _torque.copy(_fwd).scale(rollAmount * t.antiRollTorque, _torque);
      b.torque.vadd(_torque, b.torque);
    }
    const pitchAmount = _fwd.y;
    if (_up.y > 0.2 && Math.abs(pitchAmount) > 0.2) {
      _torque.copy(_right).scale(-pitchAmount * t.antiRollTorque * 0.6, _torque);
      b.torque.vadd(_torque, b.torque);
    }

    // Flip / stuck detection (recovery is offered to the player, never forced mid-drive).
    if (_up.y < t.flipUpThreshold) this.flippedTime += h;
    else this.flippedTime = 0;
    const pushing = this.enabled && (c.throttle > 0.3 || c.brake > 0.3);
    if (pushing && Math.abs(speed) < t.stuckSpeed && b.velocity.length() < t.stuckSpeed) this.stuckTime += h;
    else this.stuckTime = Math.max(0, this.stuckTime - h * 2);
  }

  get isFlipped(): boolean {
    return this.flippedTime > this.t.flipConfirmTime;
  }

  get isStuck(): boolean {
    return this.stuckTime > this.t.stuckTime;
  }

  /** Places the car upright at a position/yaw with zero velocity. */
  reset(x: number, y: number, z: number, yaw: number): void {
    const b = this.chassis;
    b.position.set(x, y, z);
    b.quaternion.setFromEuler(0, yaw, 0);
    b.velocity.setZero();
    b.angularVelocity.setZero();
    b.force.setZero();
    b.torque.setZero();
    b.previousPosition.copy(b.position);
    b.interpolatedPosition.copy(b.position);
    b.previousQuaternion.copy(b.quaternion);
    b.interpolatedQuaternion.copy(b.quaternion);
    this.steerAngle = 0;
    this.flippedTime = 0;
    this.stuckTime = 0;
    b.wakeUp();
  }

  yaw(): number {
    this.chassis.vectorToWorldFrame(LOCAL_FWD, _fwd);
    return Math.atan2(-_fwd.x, -_fwd.z);
  }

  upY(): number {
    this.chassis.vectorToWorldFrame(LOCAL_UP, _up);
    return _up.y;
  }

  dispose(): void {
    this.vehicle.removeFromWorld(this.world);
  }
}
