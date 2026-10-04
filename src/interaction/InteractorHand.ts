import * as THREE from 'three';
import type { ControllerState } from '../input/ControllerState';
import type { Interactable } from './Interactable';
import type { Grabbable } from './Grabbable';

export type HandId = 'left' | 'right' | 'desktop';

const HISTORY = 8;

/**
 * One interacting hand: an XR controller or the desktop "virtual hand" in front of the camera.
 * Holds input edges for this frame, hover/held state, a velocity history for throwing,
 * a simple procedural hand visual and the pointer ray visual.
 */
export class InteractorHand {
  // Inputs (written by InteractionManager each frame)
  gripDown = false;
  gripUp = false;
  gripHeld = false;
  gripValue = 0;
  triggerDown = false;
  triggerUp = false;
  triggerHeld = false;
  triggerValue = 0;

  hover: Interactable | null = null;
  hoverFar = false;
  readonly hoverPoint = new THREE.Vector3();
  held: Grabbable | null = null;
  active = true;

  readonly visual = new THREE.Group();
  private readonly fingers: THREE.Object3D[] = [];
  private readonly indexFinger: THREE.Object3D;
  readonly rayLine: THREE.Line;
  private readonly rayCursor: THREE.Mesh;

  private readonly posHistory: THREE.Vector3[] = [];
  private readonly quatHistory: THREE.Quaternion[] = [];
  private readonly timeHistory: number[] = [];
  private historyIndex = 0;
  private historyCount = 0;
  private time = 0;

  constructor(
    readonly id: HandId,
    /** Palm pose (XR grip space). */
    readonly grip: THREE.Object3D,
    /** Pointing pose (XR target-ray space, forward = -Z). */
    readonly ray: THREE.Object3D,
    readonly controller: ControllerState | null,
  ) {
    for (let i = 0; i < HISTORY; i++) {
      this.posHistory.push(new THREE.Vector3());
      this.quatHistory.push(new THREE.Quaternion());
      this.timeHistory.push(0);
    }
    // --- Stylised hand (palm + 4 fingers + thumb). Fingers curl with grip, index with trigger.
    const mirror = id === 'left' ? -1 : 1;
    const skin = new THREE.MeshLambertMaterial({ color: 0x2b3440, emissive: 0x0b1a22 });
    const accent = new THREE.MeshBasicMaterial({ color: id === 'left' ? 0xff4fd8 : 0x3df5ff });
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.025, 0.09), skin);
    palm.position.set(0, -0.005, 0.03);
    this.visual.add(palm);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.077, 0.004, 0.02), accent);
    stripe.position.set(0, 0.009, 0.05);
    this.visual.add(stripe);
    const fingerGeo = new THREE.BoxGeometry(0.016, 0.016, 0.07);
    fingerGeo.translate(0, 0, -0.035);
    const pivots: THREE.Object3D[] = [];
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Object3D();
      pivot.position.set((-0.027 + i * 0.018) * mirror, -0.005, -0.015);
      pivot.add(new THREE.Mesh(fingerGeo, skin));
      this.visual.add(pivot);
      pivots.push(pivot);
    }
    this.indexFinger = pivots[0];
    this.fingers.push(...pivots.slice(1));
    const thumbPivot = new THREE.Object3D();
    thumbPivot.position.set(-0.04 * mirror, -0.01, 0.03);
    thumbPivot.rotation.y = 0.6 * mirror;
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.055), skin);
    thumb.position.z = -0.025;
    thumbPivot.add(thumb);
    this.visual.add(thumbPivot);
    this.fingers.push(thumbPivot);
    this.visual.visible = id !== 'desktop';
    grip.add(this.visual);

    const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    this.rayLine = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0x9ff8ff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.rayLine.visible = false;
    this.rayLine.frustumCulled = false;
    if (id !== 'desktop') ray.add(this.rayLine);
    this.rayCursor = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
    );
    this.rayCursor.renderOrder = 999;
    this.rayCursor.visible = false;
  }

  /** Adds the cursor to the scene (must be world-space). */
  attachCursor(scene: THREE.Scene): void {
    scene.add(this.rayCursor);
  }

  /** Point used for direct touches (palm centre slightly forward). */
  touchPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -0.02).applyMatrix4(this.grip.matrixWorld);
  }

  /** Index finger tip, used for poking buttons. */
  tipPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, -0.005, -0.09).applyMatrix4(this.grip.matrixWorld);
  }

  rayOrigin(out: THREE.Vector3): THREE.Vector3 {
    return this.ray.getWorldPosition(out);
  }

  rayDirection(out: THREE.Vector3): THREE.Vector3 {
    // Object3D.getWorldDirection returns +Z; cameras override it to return -Z.
    this.ray.getWorldDirection(out);
    if (!(this.ray as THREE.Camera).isCamera) out.negate();
    return out;
  }

  /** Records the grip pose for throw velocity estimation. */
  recordPose(dt: number): void {
    this.time += dt;
    const i = this.historyIndex;
    this.grip.getWorldPosition(this.posHistory[i]);
    this.grip.getWorldQuaternion(this.quatHistory[i]);
    this.timeHistory[i] = this.time;
    this.historyIndex = (i + 1) % HISTORY;
    this.historyCount = Math.min(HISTORY, this.historyCount + 1);
  }

  /** Average linear velocity over the last ~80 ms. */
  getVelocity(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    if (this.historyCount < 2) return out;
    const newest = (this.historyIndex - 1 + HISTORY) % HISTORY;
    let oldest = newest;
    for (let k = 1; k < this.historyCount; k++) {
      const idx = (newest - k + HISTORY) % HISTORY;
      oldest = idx;
      if (this.timeHistory[newest] - this.timeHistory[idx] >= 0.08) break;
    }
    const span = this.timeHistory[newest] - this.timeHistory[oldest];
    if (span <= 1e-4) return out;
    return out.subVectors(this.posHistory[newest], this.posHistory[oldest]).divideScalar(span);
  }

  /** Angular velocity (rad/s, world axis * rate) from the last two samples. */
  getAngularVelocity(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    if (this.historyCount < 3) return out;
    const a = (this.historyIndex - 3 + HISTORY) % HISTORY;
    const b = (this.historyIndex - 1 + HISTORY) % HISTORY;
    const span = this.timeHistory[b] - this.timeHistory[a];
    if (span <= 1e-4) return out;
    const dq = this.quatHistory[b].clone().multiply(this.quatHistory[a].clone().invert());
    if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
    const angle = 2 * Math.acos(Math.min(1, dq.w));
    const s = Math.sqrt(1 - dq.w * dq.w);
    if (s < 1e-4) return out;
    return out.set(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(angle / span);
  }

  pulse(intensity: number, ms: number): void {
    this.controller?.pulse(intensity, ms);
  }

  /** Updates finger curl + pointer visuals. */
  updateVisual(rayLength: number | null, cursorPoint: THREE.Vector3 | null): void {
    const g = this.held ? 1 : this.gripValue;
    for (const f of this.fingers) f.rotation.x = -g * 1.2;
    this.indexFinger.rotation.x = -Math.max(this.triggerValue, this.held ? 0.7 : 0) * 1.1;
    if (rayLength !== null && this.id !== 'desktop') {
      this.rayLine.visible = true;
      this.rayLine.scale.set(1, 1, rayLength);
    } else {
      this.rayLine.visible = false;
    }
    if (cursorPoint) {
      this.rayCursor.visible = true;
      this.rayCursor.position.copy(cursorPoint);
    } else {
      this.rayCursor.visible = false;
    }
  }
}
