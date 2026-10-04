import * as CANNON from 'cannon-es';
import type * as THREE from 'three';
import { COL, MASK } from '../config/layers';

export interface SyncedBody {
  body: CANNON.Body;
  object: THREE.Object3D;
  /** When false the object is driven by gameplay code (held items etc.) */
  sync: boolean;
}

/**
 * Thin wrapper around a cannon-es world: fixed 60 Hz stepping with render
 * interpolation, static box helpers and mesh synchronisation.
 */
export class PhysicsWorld {
  readonly world: CANNON.World;
  readonly fixedStep = 1 / 60;
  private readonly synced: SyncedBody[] = [];
  private readonly fixedHooks: ((h: number) => void)[] = [];
  /** Wall time spent in the last step() call (ms) - shown on the debug overlay. */
  lastStepMs = 0;
  readonly groundMaterial = new CANNON.Material('ground');
  readonly propMaterial = new CANNON.Material('prop');

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    (this.world.solver as CANNON.GSSolver).iterations = 10;
    this.world.defaultContactMaterial.friction = 0.4;
    this.world.defaultContactMaterial.restitution = 0.1;
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.groundMaterial, this.propMaterial, { friction: 0.5, restitution: 0.15 }),
    );

    // NOTE: a large thin Box is used instead of CANNON.Plane: in cannon-es 0.20 ray casts
    // (used by RaycastVehicle wheels) miss a rotated Plane for z > 0.
    const ground = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(200, 0.5, 200)),
      position: new CANNON.Vec3(0, -0.5, 0),
      material: this.groundMaterial,
      collisionFilterGroup: COL.STATIC,
      collisionFilterMask: MASK.STATIC,
    });
    this.world.addBody(ground);

    // Fixed-rate gameplay hooks run inside every physics sub-step (before integration).
    this.world.addEventListener('preStep', () => {
      for (const hook of this.fixedHooks) hook(this.fixedStep);
    });
  }

  /** Registers a callback executed once per fixed physics step (before integration). */
  onFixedStep(hook: (h: number) => void): void {
    this.fixedHooks.push(hook);
  }

  addStaticBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, group: number = COL.STATIC): CANNON.Body {
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
      position: new CANNON.Vec3(cx, cy, cz),
      material: this.groundMaterial,
      collisionFilterGroup: group,
      collisionFilterMask: MASK.STATIC,
    });
    this.world.addBody(body);
    return body;
  }

  addStaticCylinder(cx: number, cy: number, cz: number, radius: number, height: number): CANNON.Body {
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      shape: new CANNON.Cylinder(radius, radius, height, 8),
      position: new CANNON.Vec3(cx, cy, cz),
      material: this.groundMaterial,
      collisionFilterGroup: COL.STATIC,
      collisionFilterMask: MASK.STATIC,
    });
    this.world.addBody(body);
    return body;
  }

  /** Links a body to a render object; the object follows the interpolated body pose. */
  link(body: CANNON.Body, object: THREE.Object3D): SyncedBody {
    const entry = { body, object, sync: true };
    this.synced.push(entry);
    return entry;
  }

  step(dt: number): void {
    const t0 = performance.now();
    // Clamp huge frame gaps (tab switches, XR session start) to avoid a spiral of death.
    const clamped = Math.min(dt, 0.1);
    this.world.step(this.fixedStep, clamped, 4);
    for (const s of this.synced) {
      if (!s.sync) continue;
      const b = s.body;
      if (b.type === CANNON.Body.STATIC) continue;
      s.object.position.set(b.interpolatedPosition.x, b.interpolatedPosition.y, b.interpolatedPosition.z);
      s.object.quaternion.set(b.interpolatedQuaternion.x, b.interpolatedQuaternion.y, b.interpolatedQuaternion.z, b.interpolatedQuaternion.w);
    }
    this.lastStepMs = performance.now() - t0;
  }

  /** Closest dynamic/kinematic body hit along a segment (projectiles, interaction checks). */
  raycastBodies(from: CANNON.Vec3, to: CANNON.Vec3, mask: number): CANNON.RaycastResult | null {
    const result = new CANNON.RaycastResult();
    this.world.raycastClosest(from, to, { collisionFilterMask: mask, skipBackfaces: true }, result);
    return result.hasHit ? result : null;
  }
}
