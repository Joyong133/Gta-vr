import * as THREE from 'three';
import { tuning } from '../config/tuning';

const _v = new THREE.Vector3();
const _h = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The player's tracking origin.
 *
 *   rig (world position of the tracked floor origin, yaw only)
 *    └ trackingSpace (y = seated / height-calibration offset)
 *        ├ camera            (head pose: written by WebXR or by desktop mouse look)
 *        ├ XR controllers    (target-ray spaces)
 *        └ XR grips          (grip spaces)
 *
 * Gameplay never rotates or shakes the camera itself: locomotion moves/rotates
 * the rig, which respects the real head tracking.
 */
export class PlayerRig {
  readonly rig = new THREE.Group();
  readonly trackingSpace = new THREE.Group();
  readonly camera: THREE.PerspectiveCamera;
  /** Desktop-only pitch (XR head pitch comes from the headset). */
  private desktopPitch = 0;
  xr = false;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.rig.name = 'PlayerRig';
    this.trackingSpace.name = 'TrackingSpace';
    this.rig.add(this.trackingSpace);
    this.trackingSpace.add(camera);
    camera.position.set(0, tuning.player.eyeHeightDesktop, 0);
  }

  setHeightOffset(offset: number): void {
    this.trackingSpace.position.y = offset;
  }

  /**
   * Refreshes the camera pose for this frame. In XR this pulls the current
   * viewer pose so gameplay sees the up-to-date head instead of last frame's.
   */
  syncHead(renderer: THREE.WebGLRenderer): void {
    this.rig.updateMatrixWorld(true);
    if (this.xr && renderer.xr.isPresenting) {
      renderer.xr.updateCamera(this.camera);
    } else {
      this.camera.position.set(0, tuning.player.eyeHeightDesktop, 0);
      _e.set(this.desktopPitch, 0, 0);
      this.camera.quaternion.setFromEuler(_e);
      this.camera.updateMatrixWorld(true);
    }
  }

  /** Recomputes world matrices after the rig was moved directly. */
  syncHeadMatrices(): void {
    this.rig.updateMatrixWorld(true);
  }

  /** Desktop mouse look: yaw rotates the rig around the head, pitch tilts the camera. */
  applyDesktopLook(dYaw: number, dPitch: number): void {
    if (dYaw !== 0) this.rotateAroundHead(-dYaw);
    this.desktopPitch = THREE.MathUtils.clamp(this.desktopPitch - dPitch, -1.35, 1.35);
  }

  resetDesktopPitch(): void {
    this.desktopPitch = 0;
  }

  headWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.camera.getWorldPosition(out);
  }

  /** Head position relative to the tracking origin (includes height offset). */
  headLocalInRig(out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.camera.position);
    out.y += this.trackingSpace.position.y;
    return out;
  }

  /** Yaw of the head's forward direction on the XZ plane (world). */
  headYaw(): number {
    this.camera.getWorldDirection(_v);
    return Math.atan2(-_v.x, -_v.z);
  }

  /** Raw tracked head height above the physical floor (no offsets). */
  trackedHeadHeight(): number {
    return this.camera.position.y;
  }

  rigYaw(): number {
    _e.setFromQuaternion(this.rig.quaternion, 'YXZ');
    return _e.y;
  }

  setRigYaw(yaw: number): void {
    this.rig.quaternion.setFromAxisAngle(UP, yaw);
  }

  /** Rotates the rig about the vertical axis through the head (snap / smooth turn). */
  rotateAroundHead(angle: number): void {
    this.rig.updateMatrixWorld(true);
    const head = this.headWorld(_h);
    _q.setFromAxisAngle(UP, angle);
    _v.copy(this.rig.position).sub(head).applyQuaternion(_q);
    this.rig.position.copy(head).add(_v);
    this.rig.quaternion.premultiply(_q);
    this.rig.updateMatrixWorld(true);
  }

  /** Moves the rig so that the head ends up above (x, z), with the floor at y. */
  placeHeadAt(x: number, z: number, floorY: number): void {
    this.rig.updateMatrixWorld(true);
    const head = this.headWorld(_h);
    this.rig.position.x += x - head.x;
    this.rig.position.z += z - head.z;
    this.rig.position.y = floorY;
    this.rig.updateMatrixWorld(true);
  }

  /** Sets a full spawn pose: head above (x,z) looking along yaw. */
  spawnAt(x: number, z: number, floorY: number, yaw: number): void {
    this.rig.updateMatrixWorld(true);
    // Face the requested yaw with the *head*, not just the rig.
    const headYaw = this.headYaw();
    this.rotateAroundHead(yaw - headYaw);
    this.placeHeadAt(x, z, floorY);
  }

  translate(dx: number, dz: number): void {
    this.rig.position.x += dx;
    this.rig.position.z += dz;
  }
}
