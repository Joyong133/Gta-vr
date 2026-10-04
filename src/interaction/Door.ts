import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Obb2 } from '../world/geom2d';
import { Interactable } from './Interactable';
import type { InteractorHand } from './InteractorHand';

export interface Draggable {
  beginDrag(hand: InteractorHand): void;
  updateDrag(hand: InteractorHand, dt: number): void;
  endDrag(hand: InteractorHand): void;
}

export interface DoorOptions {
  id: string;
  /** Hinge object; the door rotates about its local Y axis. */
  pivot: THREE.Object3D;
  /** Visual panel meshes (highlighted on hover). */
  meshes: THREE.Mesh[];
  /** Handle position in pivot space (grab anchor). */
  handle: THREE.Vector3;
  width: number;
  thickness?: number;
  minAngle?: number;
  maxAngle?: number;
  /** +1: panel extends along pivot +X, -1: along -X. */
  panelSign?: 1 | -1;
  blocksPlayer?: boolean;
  autoClose?: boolean;
}

const _hand = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Hinged door: grab the handle and swing it, or select (trigger / click / A)
 * to open/close automatically. Exposes a footprint OBB so a closed door
 * blocks the player and NPCs.
 */
export class Door extends Interactable implements Draggable {
  angle = 0;
  private angVel = 0;
  private target: number | null = null;
  private dragHand: InteractorHand | null = null;
  private dragOffset = 0;
  private lastDragAngle = 0;
  readonly minAngle: number;
  readonly maxAngle: number;
  readonly panelSign: 1 | -1;
  readonly width: number;
  readonly thickness: number;
  readonly blocksPlayer: boolean;
  readonly autoClose: boolean;
  private readonly handle: THREE.Vector3;
  private wasOpen = false;
  onOpen?: () => void;
  onClose?: () => void;
  locked = false;
  readonly obb: Obb2 = { cx: 0, cz: 0, yaw: 0, halfW: 0.5, halfL: 0.05 };

  constructor(readonly opts: DoorOptions) {
    super(opts.id, 'door', opts.pivot);
    this.verb = '열기';
    this.minAngle = opts.minAngle ?? 0;
    this.maxAngle = opts.maxAngle ?? Math.PI * 0.55;
    this.panelSign = opts.panelSign ?? 1;
    this.width = opts.width;
    this.thickness = opts.thickness ?? 0.08;
    this.blocksPlayer = opts.blocksPlayer ?? true;
    this.autoClose = opts.autoClose ?? false;
    this.handle = opts.handle.clone();
    this.nearRadius = 0.16;
    this.farRadius = 0.3;
    this.maxFarDistance = 4;
    this.addHighlightMeshes(...opts.meshes);
  }

  get pivot(): THREE.Object3D {
    return this.opts.pivot;
  }

  get isOpen(): boolean {
    return Math.abs(this.angle) > 0.5;
  }

  getAnchor(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.handle).applyMatrix4(this.pivot.matrixWorld);
  }

  select(): void {
    if (this.locked) return;
    this.toggle();
  }

  toggle(): void {
    const mid = (this.minAngle + this.maxAngle) / 2;
    const openTarget = Math.abs(this.maxAngle) > Math.abs(this.minAngle) ? this.maxAngle : this.minAngle;
    this.target = Math.abs(this.angle) > Math.abs(mid) * 0.4 ? 0 : openTarget;
  }

  open(): void {
    this.target = Math.abs(this.maxAngle) > Math.abs(this.minAngle) ? this.maxAngle : this.minAngle;
  }

  close(): void {
    this.target = 0;
  }

  /** Angle the hand currently implies, measured in the pivot's parent space. */
  private handAngle(hand: InteractorHand): number {
    const parent = this.pivot.parent;
    hand.touchPoint(_hand);
    if (parent) {
      parent.updateWorldMatrix(true, false);
      _m.copy(parent.matrixWorld).invert();
      _hand.applyMatrix4(_m);
    }
    const vx = (_hand.x - this.pivot.position.x) * this.panelSign;
    const vz = (_hand.z - this.pivot.position.z) * this.panelSign;
    return Math.atan2(-vz, vx);
  }

  beginDrag(hand: InteractorHand): void {
    if (this.locked) {
      hand.pulse(0.6, 60);
      return;
    }
    this.dragHand = hand;
    this.target = null;
    this.dragOffset = this.handAngle(hand) - this.angle;
    this.lastDragAngle = this.angle;
    hand.pulse(0.3, 30);
  }

  updateDrag(hand: InteractorHand, dt: number): void {
    if (this.dragHand !== hand) return;
    let a = this.handAngle(hand) - this.dragOffset;
    // unwrap
    while (a - this.angle > Math.PI) a -= Math.PI * 2;
    while (a - this.angle < -Math.PI) a += Math.PI * 2;
    const clamped = clamp(a, this.minAngle, this.maxAngle);
    if (clamped !== a && Math.abs(clamped - this.angle) > 0.001) hand.pulse(0.2, 15);
    this.angle = clamped;
    this.angVel = dt > 0 ? (this.angle - this.lastDragAngle) / dt : 0;
    this.lastDragAngle = this.angle;
  }

  endDrag(hand: InteractorHand): void {
    if (this.dragHand !== hand) return;
    this.dragHand = null;
    this.angVel = clamp(this.angVel, -6, 6);
  }

  get isDragged(): boolean {
    return this.dragHand !== null;
  }

  update(dt: number): void {
    if (!this.dragHand) {
      if (this.target !== null) {
        const d = this.target - this.angle;
        const step = 2.8 * dt;
        if (Math.abs(d) <= step) {
          this.angle = this.target;
          this.target = null;
        } else this.angle += Math.sign(d) * step;
        this.angVel = 0;
      } else if (Math.abs(this.angVel) > 0.01) {
        this.angle += this.angVel * dt;
        this.angVel *= Math.exp(-3.5 * dt);
        if (this.angle > this.maxAngle || this.angle < this.minAngle) {
          this.angle = clamp(this.angle, this.minAngle, this.maxAngle);
          this.angVel *= -0.25;
        }
      } else if (this.autoClose && Math.abs(this.angle) > 0.001 && Math.abs(this.angle) < 0.25) {
        this.angle = 0;
      }
    }
    this.pivot.rotation.y = this.angle;
    const open = this.isOpen;
    if (open && !this.wasOpen) this.onOpen?.();
    if (!open && this.wasOpen && Math.abs(this.angle) < 0.05) this.onClose?.();
    if (open || Math.abs(this.angle) < 0.05) this.wasOpen = open;
    this.updateObb();
  }

  private updateObb(): void {
    this.pivot.updateWorldMatrix(true, false);
    _a.set(0, 0, 0).applyMatrix4(this.pivot.matrixWorld);
    _b.set(this.width * this.panelSign, 0, 0).applyMatrix4(this.pivot.matrixWorld);
    const ex = _b.x - _a.x;
    const ez = _b.z - _a.z;
    this.obb.cx = (_a.x + _b.x) / 2;
    this.obb.cz = (_a.z + _b.z) / 2;
    this.obb.yaw = Math.atan2(-ez, ex);
    this.obb.halfW = this.width / 2;
    this.obb.halfL = this.thickness / 2;
  }
}
