import * as THREE from 'three';
import { Interactable } from './Interactable';
import type { InteractorHand } from './InteractorHand';

const _tip = new THREE.Vector3();
const _inv = new THREE.Matrix4();

/**
 * Physical push button. The button faces its base's local +Z.
 * Press it by poking with the index finger tip (near) or by selecting it
 * with the ray / mouse (animated press).
 */
export class PushButton extends Interactable {
  readonly base: THREE.Object3D;
  readonly cap: THREE.Mesh;
  private depth = 0;
  private latched = false;
  private animT = -1;
  private cooldown = 0;
  readonly travel = 0.014;
  readonly radius: number;
  onPress?: (hand: InteractorHand | null) => void;

  constructor(id: string, base: THREE.Object3D, radius = 0.035, color = 0xff3d6e, label?: string) {
    super(id, 'button', base);
    this.base = base;
    this.radius = radius;
    this.verb = label ?? '누르기';
    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.45, radius * 1.45, 0.02, 20),
      new THREE.MeshLambertMaterial({ color: 0x1b1f27 }),
    );
    housing.rotation.x = Math.PI / 2;
    housing.position.z = 0.01;
    base.add(housing);
    this.cap = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 0.022, 20),
      new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.35) }),
    );
    this.cap.rotation.x = Math.PI / 2;
    this.cap.position.z = 0.031;
    base.add(this.cap);
    this.nearRadius = radius + 0.06;
    this.farRadius = radius * 2.2;
    this.maxFarDistance = 5;
    this.addHighlightMeshes(this.cap);
  }

  select(hand: InteractorHand): void {
    if (this.animT < 0) this.animT = 0;
    this.fire(hand);
  }

  hoverUpdate(hand: InteractorHand): void {
    // Poke detection in button space.
    this.base.updateWorldMatrix(true, false);
    _inv.copy(this.base.matrixWorld).invert();
    hand.tipPoint(_tip).applyMatrix4(_inv);
    const capTop = 0.042;
    let d = 0;
    if (Math.hypot(_tip.x, _tip.y) < this.radius * 1.3 && _tip.z < capTop + 0.004 && _tip.z > -0.05) {
      d = Math.min(1, Math.max(0, (capTop - _tip.z) / this.travel));
    }
    this.depth = Math.max(this.depth, d);
    if (d > 0.7 && !this.latched) {
      this.latched = true;
      this.fire(hand);
    } else if (d < 0.25) {
      this.latched = false;
    }
  }

  private fire(hand: InteractorHand | null): void {
    if (this.cooldown > 0) return;
    this.cooldown = 0.35;
    hand?.pulse(0.6, 45);
    this.onPress?.(hand);
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.animT >= 0) {
      this.animT += dt;
      const t = this.animT / 0.25;
      this.depth = Math.max(this.depth, t < 0.5 ? t * 2 : Math.max(0, 2 - t * 2));
      if (t >= 1) this.animT = -1;
    }
    this.cap.position.z = 0.031 - this.depth * this.travel;
    // Spring back.
    this.depth = Math.max(0, this.depth - dt * 6);
  }
}
