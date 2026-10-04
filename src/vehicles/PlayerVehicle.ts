import type * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { tuning } from '../config/tuning';
import { bodyTags, type BodyTag } from '../core/events';
import { Door } from '../interaction/Door';
import type { Grabbable } from '../interaction/Grabbable';
import { Socket } from '../interaction/Socket';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Obb2 } from '../world/geom2d';
import { obbVsObb } from '../world/geom2d';
import type { RoadNetwork } from '../world/RoadNetwork';
import type { StaticWorld } from '../world/StaticWorld';
import { buildCarModel, type CarVisual } from './CarModel';
import { Dashboard } from './Dashboard';
import { SteeringWheelGrab } from './SteeringWheelGrab';
import { VehiclePhysics, WHEEL_LAYOUT } from './VehiclePhysics';

const _pos = new THREE.Vector3();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _tmp = { x: 0, z: 0 };

export interface ImpactInfo {
  speed: number;
  other: BodyTag | null;
  point: THREE.Vector3;
}

/**
 * The drivable car: physics + visual + driver door + dashboard +
 * passenger-seat item socket + optional steering-wheel grab + recovery.
 */
export class PlayerVehicle {
  readonly id = 'player_car';
  readonly physics: VehiclePhysics;
  readonly visual: CarVisual;
  readonly door: Door;
  readonly dashboard: Dashboard;
  readonly passengerSocket: Socket;
  readonly wheelGrab: SteeringWheelGrab;
  occupied = false;
  readonly obb: Obb2 = { cx: 0, cz: 0, yaw: 0, halfW: 0.95, halfL: 2.25 };
  onImpact?: (info: ImpactInfo) => void;
  private impactCooldown = 0;
  /** Smoothed yaw (rad) used for the horizon-locked seat. */
  readonly seatAnchor = new THREE.Object3D();

  constructor(
    scene: THREE.Scene,
    phys: PhysicsWorld,
    private readonly world: StaticWorld,
    private readonly roads: RoadNetwork,
  ) {
    this.physics = new VehiclePhysics(phys.world);
    bodyTags.set(this.physics.chassis, { kind: 'player_car', id: this.id });
    this.visual = buildCarModel('player', 0x1fb6c9);
    scene.add(this.visual.root);
    this.visual.root.add(this.seatAnchor);
    this.seatAnchor.position.copy(this.visual.seatEye);

    this.door = new Door({
      id: 'car_door',
      pivot: this.visual.doorPivot!,
      meshes: this.visual.doorMeshes!,
      handle: this.visual.doorHandleLocal!,
      width: 1.3,
      thickness: 0.1,
      minAngle: -1.25,
      maxAngle: 0,
      panelSign: 1,
      blocksPlayer: false,
      autoClose: true,
    });
    this.door.verb = '문 열기';

    this.dashboard = new Dashboard(this.visual.dashAnchor!);

    const seat = new THREE.Object3D();
    seat.position.copy(this.visual.passengerSeat).add(new THREE.Vector3(0, 0.12, 0));
    this.visual.root.add(seat);
    this.passengerSocket = new Socket('car_passenger_seat', seat, 0.7, (item: Grabbable) => item.tags.has('mission'));

    this.wheelGrab = new SteeringWheelGrab(this.visual.steeringMount!);

    this.physics.chassis.addEventListener('collide', (e: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
      if (this.impactCooldown > 0) return;
      const speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (speed < 1.2) return;
      this.impactCooldown = 0.25;
      const ri = e.contact.bi === this.physics.chassis ? e.contact.ri : e.contact.rj;
      const p = this.physics.chassis.position;
      this.onImpact?.({ speed, other: bodyTags.get(e.body) ?? null, point: new THREE.Vector3(p.x + ri.x, p.y + ri.y, p.z + ri.z) });
    });
  }

  spawn(x: number, z: number, yaw: number): void {
    this.physics.reset(x, 0.75, z, yaw);
    this.syncVisual(0);
  }

  /** Runs inside each physics sub-step. */
  fixedUpdate(h: number): void {
    this.physics.fixedUpdate(h);
  }

  get speedKmh(): number {
    return this.physics.forwardSpeed * 3.6;
  }

  get speed(): number {
    return Math.abs(this.physics.forwardSpeed);
  }

  update(dt: number): void {
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    this.syncVisual(dt);
    this.door.update(dt);
    const t = tuning.vehicle;
    const sRatio = Math.min(1, this.speed / t.steerSpeedRef);
    const maxSteer = t.maxSteerLowSpeed + (t.maxSteerHighSpeed - t.maxSteerLowSpeed) * sRatio;
    this.wheelGrab.follow(this.physics.steerAngle, maxSteer);
    this.visual.steeringSpin!.rotation.z = this.wheelGrab.wheelAngle;
    // Brake lights
    const braking = this.physics.controls.brake > 0.1 || this.physics.controls.handbrake;
    this.visual.tailMat.color.setHex(braking ? 0xff1a2e : 0x8a0f1a);
    this.updateObb();
  }

  private syncVisual(_dt: number): void {
    const b = this.physics.chassis;
    const root = this.visual.root;
    root.position.set(b.interpolatedPosition.x, b.interpolatedPosition.y, b.interpolatedPosition.z);
    root.quaternion.set(b.interpolatedQuaternion.x, b.interpolatedQuaternion.y, b.interpolatedQuaternion.z, b.interpolatedQuaternion.w);
    const infos = this.physics.vehicle.wheelInfos;
    for (let i = 0; i < 4; i++) {
      const w = infos[i];
      const pivot = this.visual.wheels[i];
      pivot.position.y = WHEEL_LAYOUT.connectionY - w.suspensionLength;
      pivot.rotation.y = w.steering;
      this.visual.wheelSpins[i].rotation.x = w.rotation;
    }
    root.updateMatrixWorld(true);
  }

  private updateObb(): void {
    const p = this.visual.root.position;
    this.obb.cx = p.x;
    this.obb.cz = p.z;
    this.obb.yaw = this.physics.yaw();
  }

  /** World pose of the driver's eye point; yaw-only when horizon lock is on. */
  seatPose(horizonLock: boolean, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
    this.seatAnchor.getWorldPosition(outPos);
    if (horizonLock) {
      _e.set(0, this.physics.yaw(), 0, 'YXZ');
      outQuat.setFromEuler(_e);
      // Use the yaw-only frame for the eye offset too so pitch never shifts the head.
      const root = this.visual.root;
      _pos.copy(this.visual.seatEye).applyQuaternion(outQuat).add(root.position);
      outPos.copy(_pos);
    } else {
      this.visual.root.getWorldQuaternion(outQuat);
    }
  }

  /** Finds a free spot next to the car to place an exiting player (driver side first). */
  findExitSpot(otherObbs: readonly Obb2[], out: THREE.Vector3): boolean {
    const root = this.visual.root;
    const yaw = this.physics.yaw();
    const candidates: [number, number][] = [
      [-1.95, 0.1],
      [1.95, 0.1],
      [0, 3.3],
      [0, -3.3],
      [-2.6, 1.8],
      [2.6, -1.8],
    ];
    const r = tuning.player.bodyRadius + 0.1;
    for (const [lx, lz] of candidates) {
      _v.set(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(root.position);
      if (this.world.isCircleBlocked(_v.x, _v.z, r)) continue;
      const probe: Obb2 = { cx: _v.x, cz: _v.z, yaw: 0, halfW: r, halfL: r };
      if (otherObbs.some((o) => obbVsObb(probe, o, _tmp))) continue;
      out.set(_v.x, 0, _v.z);
      return true;
    }
    // Last resort: behind the car, pushed out of geometry.
    _v.set(0, 0, 3.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(root.position);
    const p = { x: _v.x, z: _v.z };
    this.world.resolveCircle(p, r);
    out.set(p.x, 0, p.z);
    return false;
  }

  /**
   * Puts the car back on the nearest free stretch of road, upright, facing the lane.
   * Used for flips, getting wedged against walls, and "call my car".
   */
  recover(otherObbs: readonly Obb2[], near?: THREE.Vector3): void {
    const from = near ?? this.visual.root.position;
    const np = this.roads.nearestLanePoint(from.x, from.z);
    const lane = np.lane;
    const tryS = [0, 8, -8, 16, -16, 24, -24, 32, -32];
    const pos = { x: 0, z: 0 };
    const dir = { x: 0, z: 0 };
    for (const ds of tryS) {
      const s = Math.max(1, Math.min(lane.length - 1, np.s + ds));
      this.roads.sample(lane, s, pos, dir);
      const yaw = Math.atan2(-dir.x, -dir.z);
      const obb: Obb2 = { cx: pos.x, cz: pos.z, yaw, halfW: 1.0, halfL: 2.4 };
      if (this.world.isObbBlocked(obb)) continue;
      if (otherObbs.some((o) => obbVsObb(obb, o, _tmp))) continue;
      this.physics.reset(pos.x, 0.8, pos.z, yaw);
      this.syncVisual(0);
      this.updateObb();
      return;
    }
    this.roads.sample(lane, np.s, pos, dir);
    this.physics.reset(pos.x, 1.2, pos.z, Math.atan2(-dir.x, -dir.z));
    this.syncVisual(0);
    this.updateObb();
  }

  setHeadlights(on: boolean): void {
    this.visual.headMat.color.setHex(on ? 0xdff4ff : 0x445566);
  }

  worldPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.visual.root.position);
  }

  quaternion(out: THREE.Quaternion): THREE.Quaternion {
    return out.copy(this.visual.root.quaternion);
  }

  /** Physics body (exposed for debug + tests). */
  get body(): CANNON.Body {
    return this.physics.chassis;
  }
}
