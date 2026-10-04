import * as THREE from 'three';
import { COL } from '../config/layers';
import type { Grabbable } from './Grabbable';

/**
 * A snap point for grabbables: delivery boxes, the car's passenger seat...
 * Released items within `radius` that pass `accepts` snap in and then follow
 * the socket anchor (which may be parented to a moving vehicle).
 */
export class Socket {
  item: Grabbable | null = null;
  enabled = true;
  /** Locked sockets keep their item (e.g. a completed delivery). */
  lockOnInsert = false;
  onInsert?: (item: Grabbable) => void;
  onRemove?: (item: Grabbable) => void;
  private readonly ghost: THREE.Mesh;

  constructor(
    readonly id: string,
    readonly anchor: THREE.Object3D,
    readonly radius: number,
    readonly accepts: (item: Grabbable) => boolean,
  ) {
    // Faint ring that brightens while a matching item is held nearby.
    this.ghost = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.7, 0.012, 6, 24),
      new THREE.MeshBasicMaterial({ color: 0x3dffb0, transparent: true, opacity: 0.0, depthWrite: false }),
    );
    this.ghost.rotation.x = Math.PI / 2;
    anchor.add(this.ghost);
  }

  worldPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.anchor.getWorldPosition(out);
  }

  canAccept(item: Grabbable): boolean {
    return this.enabled && this.item === null && this.accepts(item);
  }

  insert(item: Grabbable): void {
    if (this.item) return;
    this.item = item;
    item.socket = this;
    item.setKinematic(true, COL.HELD);
    if (this.lockOnInsert) item.enabled = false;
    this.follow();
    this.onInsert?.(item);
  }

  remove(item: Grabbable): void {
    if (this.item !== item) return;
    this.item = null;
    item.socket = null;
    this.onRemove?.(item);
  }

  /** Keeps the socketed item glued to the anchor. */
  follow(): void {
    const item = this.item;
    if (!item) return;
    this.anchor.updateWorldMatrix(true, false);
    this.anchor.matrixWorld.decompose(item.object.position, item.object.quaternion, new THREE.Vector3());
    item.object.updateMatrixWorld(true);
    item.copyToBody();
  }

  /** Visual hint strength 0..1. */
  setHint(amount: number): void {
    const mat = this.ghost.material as THREE.MeshBasicMaterial;
    mat.opacity = this.item ? 0 : amount * 0.9;
    this.ghost.visible = mat.opacity > 0.01;
  }
}
