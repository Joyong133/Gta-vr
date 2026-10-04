import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { COL, MASK } from '../config/layers';
import { tuning } from '../config/tuning';
import { DEG2RAD } from '../core/math';
import type { PhysicsWorld, SyncedBody } from '../physics/PhysicsWorld';
import { Interactable } from './Interactable';
import type { InteractorHand } from './InteractorHand';
import type { Socket } from './Socket';

export type TwoHandMode = 'none' | 'aim' | 'midpoint';

export interface AttachConfig {
  /** snap = object jumps to a fixed pose in the hand; natural = keeps the pose it was grabbed at. */
  mode: 'snap' | 'natural';
  /** Position offset (metres) in hand space - adjustable per item. */
  position?: [number, number, number];
  /** Rotation offset in degrees (XYZ) in hand space - adjustable per item. */
  rotationDeg?: [number, number, number];
  /** Orient with the pointing ray instead of the grip (weapons: aim = point). */
  alignToRay?: boolean;
}

export interface GrabbableOptions {
  id: string;
  object: THREE.Object3D;
  body?: CANNON.Body | null;
  physics?: PhysicsWorld;
  attach?: AttachConfig;
  twoHand?: TwoHandMode;
  /** Local point where a second hand grabs (foregrip). */
  secondaryAnchor?: THREE.Vector3;
  itemId?: string;
  tags?: string[];
  nearRadius?: number;
  farRadius?: number;
  forceGrab?: boolean;
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _look = new THREE.Matrix4();

/**
 * A physical object that can be grabbed with one or two hands, thrown, and
 * snapped into sockets. While held it is kinematic with collisions disabled
 * (no jitter, never pushes the player); on release it becomes dynamic again
 * with the hand's velocity.
 */
export class Grabbable extends Interactable {
  readonly body: CANNON.Body | null;
  private readonly physics: PhysicsWorld | null;
  private readonly synced: SyncedBody | null = null;
  attach: AttachConfig;
  twoHand: TwoHandMode;
  readonly secondaryAnchor: THREE.Vector3 | null;
  readonly itemId: string | null;
  readonly tags: Set<string>;
  forceGrab: boolean;

  primary: InteractorHand | null = null;
  secondary: InteractorHand | null = null;
  socket: Socket | null = null;
  /** Where the item is put back if it gets lost (falls out of the world). */
  readonly home = new THREE.Vector3();
  readonly homeQuat = new THREE.Quaternion();

  private readonly offset = new THREE.Matrix4();
  private pullT = 1;
  private readonly pullFromPos = new THREE.Vector3();
  private readonly pullFromQuat = new THREE.Quaternion();

  onGrabbed?: (hand: InteractorHand) => void;
  onReleased?: (hand: InteractorHand) => void;
  /** Trigger pressed/released while held by this hand (weapons, gadgets). */
  onUse?: (hand: InteractorHand, down: boolean) => void;

  constructor(opts: GrabbableOptions) {
    super(opts.id, 'grabbable', opts.object);
    this.grabbable = true;
    this.verb = '잡기';
    this.body = opts.body ?? null;
    this.physics = opts.physics ?? null;
    this.attach = opts.attach ?? { mode: 'natural' };
    this.twoHand = opts.twoHand ?? 'none';
    this.secondaryAnchor = opts.secondaryAnchor ?? null;
    this.itemId = opts.itemId ?? null;
    this.tags = new Set(opts.tags ?? []);
    this.nearRadius = opts.nearRadius ?? 0.12;
    this.farRadius = opts.farRadius ?? Math.max(0.2, this.nearRadius + 0.08);
    this.forceGrab = opts.forceGrab ?? true;
    this.maxFarDistance = tuning.player.farGrabMaxDistance;
    if (this.body && this.physics) this.synced = this.physics.link(this.body, this.object);
    this.home.copy(opts.object.position);
    this.homeQuat.copy(opts.object.quaternion);
    const meshes: THREE.Mesh[] = [];
    opts.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    this.addHighlightMeshes(...meshes);
  }

  get isHeld(): boolean {
    return this.primary !== null;
  }

  /** Called by InteractionManager when a hand grips this object. */
  grab(hand: InteractorHand, far: boolean): void {
    if (this.primary && this.primary !== hand) {
      // Second hand joins.
      if (this.twoHand !== 'none' && !this.secondary) {
        this.secondary = hand;
        hand.held = this;
      }
      return;
    }
    if (this.socket) this.socket.remove(this);
    this.primary = hand;
    hand.held = this;
    this.setKinematic(true);
    this.object.updateMatrixWorld(true);
    if (this.attach.mode === 'snap') {
      const [px, py, pz] = this.attach.position ?? [0, 0, 0];
      const [rx, ry, rz] = this.attach.rotationDeg ?? [0, 0, 0];
      _q.setFromEuler(new THREE.Euler(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD));
      this.offset.compose(_p.set(px, py, pz), _q, _s);
    } else {
      // natural: keep current relative pose (computed against the grip).
      _m.copy(hand.grip.matrixWorld).invert();
      this.offset.multiplyMatrices(_m, this.object.matrixWorld);
      // Remove any scale picked up from the grip matrix.
      this.offset.decompose(_p, _q, _p2);
      this.offset.compose(_p, _q, _s);
    }
    if (far && this.forceGrab) {
      this.pullT = 0;
      this.pullFromPos.copy(this.object.position);
      this.pullFromQuat.copy(this.object.quaternion);
      if (this.attach.mode !== 'snap') {
        // Far grabs land in the palm instead of hovering at a distance.
        this.offset.decompose(_p, _q, _p2);
        this.offset.compose(_p.set(0, -0.02, -0.06), _q, _s);
      }
    } else {
      this.pullT = 1;
    }
    hand.pulse(0.35, 35);
    this.onGrabbed?.(hand);
  }

  /** Releases from a hand. Returns true if the object is now free (no hand holds it). */
  release(hand: InteractorHand, velocity: THREE.Vector3, angular: THREE.Vector3): boolean {
    if (hand === this.secondary) {
      this.secondary = null;
      hand.held = null;
      return false;
    }
    if (hand !== this.primary) return false;
    hand.held = null;
    if (this.secondary) {
      // Hand-over: the remaining hand becomes primary with a natural offset.
      const other = this.secondary;
      this.secondary = null;
      this.primary = null;
      other.held = null;
      this.grab(other, false);
      if (this.attach.mode === 'snap') {
        _m.copy(other.grip.matrixWorld).invert();
        this.offset.multiplyMatrices(_m, this.object.matrixWorld);
        this.offset.decompose(_p, _q, _p2);
        this.offset.compose(_p, _q, _s);
      }
      return false;
    }
    this.primary = null;
    this.setKinematic(false);
    if (this.body) {
      const v = velocity.clone().multiplyScalar(tuning.player.throwVelocityScale);
      const max = tuning.player.maxThrowSpeed;
      if (v.length() > max) v.setLength(max);
      this.body.velocity.set(v.x, v.y, v.z);
      this.body.angularVelocity.set(angular.x, angular.y, angular.z);
      this.body.wakeUp();
    }
    hand.pulse(0.15, 20);
    this.onReleased?.(hand);
    return true;
  }

  /** Puts the object into kinematic follow mode (held / socketed) or back to dynamic. */
  setKinematic(on: boolean, group: number = COL.HELD): void {
    if (this.synced) this.synced.sync = !on;
    const b = this.body;
    if (!b) return;
    if (on) {
      b.type = CANNON.Body.KINEMATIC;
      b.collisionFilterGroup = group;
      b.collisionFilterMask = MASK.NONE;
      b.velocity.setZero();
      b.angularVelocity.setZero();
    } else {
      b.type = CANNON.Body.DYNAMIC;
      b.collisionFilterGroup = COL.PROP;
      b.collisionFilterMask = MASK.PROP;
      b.position.set(this.object.position.x, this.object.position.y, this.object.position.z);
      b.quaternion.set(this.object.quaternion.x, this.object.quaternion.y, this.object.quaternion.z, this.object.quaternion.w);
      b.previousPosition.copy(b.position);
      b.interpolatedPosition.copy(b.position);
      b.previousQuaternion.copy(b.quaternion);
      b.interpolatedQuaternion.copy(b.quaternion);
    }
    b.updateMassProperties();
    b.aabbNeedsUpdate = true;
  }

  /** Moves the held object to follow its hand(s). Called every frame while held. */
  updateHeld(dt: number): void {
    const hand = this.primary;
    if (!hand) return;
    const target = this.computeTarget(hand);
    target.decompose(_p, _q, _p2);
    if (this.pullT < 1) {
      this.pullT = Math.min(1, this.pullT + dt / tuning.player.forceGrabPullTime);
      const t = 1 - (1 - this.pullT) ** 3;
      _p.lerpVectors(this.pullFromPos, _p, t);
      _q.slerpQuaternions(this.pullFromQuat, _q, t);
    }
    this.object.position.copy(_p);
    this.object.quaternion.copy(_q);
    this.object.updateMatrixWorld(true);
    this.copyToBody();
  }

  copyToBody(): void {
    if (!this.body) return;
    this.body.position.set(this.object.position.x, this.object.position.y, this.object.position.z);
    this.body.quaternion.set(this.object.quaternion.x, this.object.quaternion.y, this.object.quaternion.z, this.object.quaternion.w);
    this.body.aabbNeedsUpdate = true;
  }

  private computeTarget(hand: InteractorHand): THREE.Matrix4 {
    if (this.attach.alignToRay) {
      // Position from the grip, orientation from the pointing ray.
      hand.grip.getWorldPosition(_p2);
      hand.ray.getWorldQuaternion(_q);
      _m2.compose(_p2, _q, _s);
    } else {
      _m2.copy(hand.grip.matrixWorld);
      _m2.decompose(_p2, _q, _fwd);
      _m2.compose(_p2, _q, _s);
    }
    _m.multiplyMatrices(_m2, this.offset);
    const second = this.secondary;
    if (!second) return _m;

    if (this.twoHand === 'aim') {
      // Primary hand positions, secondary hand defines the aim direction.
      _m.decompose(_p, _q, _p2);
      hand.grip.getWorldPosition(_p2);
      second.grip.getWorldPosition(_fwd);
      _fwd.sub(_p2);
      if (_fwd.lengthSq() > 0.0025) {
        _fwd.normalize();
        _up.set(0, 1, 0).applyQuaternion(_q);
        // lookAt makes +Z point from target to eye, so the object's -Z (barrel) points along _fwd.
        _look.lookAt(_p2.set(0, 0, 0), _fwd, _up);
        _q.setFromRotationMatrix(_look);
      }
      return _m.compose(_p, _q, _s);
    }
    // midpoint: centred between hands, level, spanning the hands.
    hand.grip.getWorldPosition(_p);
    second.grip.getWorldPosition(_p2);
    _right.subVectors(_p2, _p);
    _right.y = 0;
    if (_right.lengthSq() < 1e-4) _right.set(1, 0, 0);
    _right.normalize();
    _up.set(0, 1, 0);
    _fwd.crossVectors(_right, _up).normalize(); // +Z axis of a right-handed basis
    _look.makeBasis(_right, _up, _fwd);
    _q.setFromRotationMatrix(_look);
    _p.add(_p2).multiplyScalar(0.5);
    _p.y -= 0.05;
    return _m.compose(_p, _q, _s);
  }

  /** Returns the object to its spawn pose (used when it falls out of the world). */
  resetToHome(): void {
    if (this.primary) return;
    if (this.socket) this.socket.remove(this);
    this.object.position.copy(this.home);
    this.object.quaternion.copy(this.homeQuat);
    this.setKinematic(false);
    if (this.body) {
      this.body.velocity.setZero();
      this.body.angularVelocity.setZero();
    }
  }

  setHome(pos: THREE.Vector3, quat?: THREE.Quaternion): void {
    this.home.copy(pos);
    if (quat) this.homeQuat.copy(quat);
  }

  /** Teleports a free item (mission spawns). */
  placeAt(pos: THREE.Vector3, quat?: THREE.Quaternion): void {
    if (this.socket) this.socket.remove(this);
    this.object.position.copy(pos);
    if (quat) this.object.quaternion.copy(quat);
    this.object.updateMatrixWorld(true);
    this.setKinematic(false);
    if (this.body) {
      this.body.velocity.setZero();
      this.body.angularVelocity.setZero();
      this.body.wakeUp();
    }
  }
}
