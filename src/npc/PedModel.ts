import * as THREE from 'three';
import { PrimitiveBatch } from '../world/MeshBatch';

export interface PedLook {
  shirt: THREE.ColorRepresentation;
  pants: THREE.ColorRepresentation;
  skin: THREE.ColorRepresentation;
  hair: THREE.ColorRepresentation;
  hat?: THREE.ColorRepresentation;
  accent?: THREE.ColorRepresentation;
  height?: number;
}

/**
 * Low-poly humanoid built from primitives. Torso/head are merged into one
 * mesh; arms and legs are separate pivots for procedural animation.
 * Distant pedestrians hide their limbs (cheap LOD).
 */
export class PedModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly legL = new THREE.Group();
  readonly legR = new THREE.Group();
  readonly armL = new THREE.Group();
  readonly armR = new THREE.Group();
  private readonly limbs: THREE.Object3D[];
  private phase = Math.random() * 10;
  readonly scale: number;

  constructor(look: PedLook) {
    this.scale = look.height ?? 1;
    const b = new PrimitiveBatch();
    b.box(0, 1.17, 0, 0.42, 0.56, 0.24, look.shirt);
    b.box(0, 0.86, 0, 0.38, 0.14, 0.22, look.pants);
    b.box(0, 1.47, 0, 0.12, 0.08, 0.12, look.skin); // neck
    b.add(new THREE.SphereGeometry(0.12, 10, 8), 0, 1.6, 0, look.skin);
    b.add(new THREE.SphereGeometry(0.125, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.62, 0.01, look.hair);
    if (look.hat) {
      b.add(new THREE.CylinderGeometry(0.135, 0.14, 0.08, 12), 0, 1.72, 0, look.hat);
      b.box(0, 1.69, -0.12, 0.2, 0.02, 0.1, look.hat);
    }
    if (look.accent) b.box(0.1, 1.3, -0.125, 0.07, 0.07, 0.01, look.accent);
    const torso = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    torso.castShadow = true;
    this.body.add(torso);

    const legGeo = new THREE.BoxGeometry(0.15, 0.82, 0.17);
    legGeo.translate(0, -0.41, 0);
    const legMat = new THREE.MeshLambertMaterial({ color: look.pants });
    const shoe = new THREE.BoxGeometry(0.15, 0.08, 0.26);
    shoe.translate(0, -0.82, -0.04);
    const shoeMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1f });
    for (const [leg, x] of [
      [this.legL, -0.1],
      [this.legR, 0.1],
    ] as const) {
      leg.position.set(x, 0.86, 0);
      const m = new THREE.Mesh(legGeo, legMat);
      m.castShadow = true;
      leg.add(m, new THREE.Mesh(shoe, shoeMat));
      this.body.add(leg);
    }
    const armGeo = new THREE.BoxGeometry(0.1, 0.58, 0.11);
    armGeo.translate(0, -0.29, 0);
    const armMat = new THREE.MeshLambertMaterial({ color: look.shirt });
    const hand = new THREE.BoxGeometry(0.09, 0.1, 0.1);
    hand.translate(0, -0.62, 0);
    const handMat = new THREE.MeshLambertMaterial({ color: look.skin });
    for (const [arm, x] of [
      [this.armL, -0.27],
      [this.armR, 0.27],
    ] as const) {
      arm.position.set(x, 1.42, 0);
      arm.add(new THREE.Mesh(armGeo, armMat), new THREE.Mesh(hand, handMat));
      this.body.add(arm);
    }
    this.limbs = [this.legL, this.legR, this.armL, this.armR];
    this.body.scale.setScalar(this.scale);
    this.root.add(this.body);
  }

  /** Walk/run cycle; speed in m/s. */
  animateWalk(dt: number, speed: number): void {
    this.phase += dt * (2.2 + speed * 2.4);
    const amp = Math.min(0.75, speed * 0.32);
    const s = Math.sin(this.phase);
    this.legL.rotation.x = s * amp;
    this.legR.rotation.x = -s * amp;
    this.armL.rotation.x = -s * amp * 0.8;
    this.armR.rotation.x = s * amp * 0.8;
    this.armL.rotation.z = 0;
    this.armR.rotation.z = 0;
    this.body.position.y = Math.abs(Math.cos(this.phase)) * amp * 0.05;
    this.body.rotation.x = speed > 3 ? -0.15 : 0;
  }

  /** Crouched, arms over the head. */
  poseCower(): void {
    this.legL.rotation.x = -1.2;
    this.legR.rotation.x = -1.2;
    this.armL.rotation.x = -2.6;
    this.armR.rotation.x = -2.6;
    this.armL.rotation.z = 0.4;
    this.armR.rotation.z = -0.4;
    this.body.position.y = -0.38;
    this.body.rotation.x = 0.35;
  }

  /** Arms raised (talking / waving). */
  poseWave(t: number): void {
    this.legL.rotation.x = 0;
    this.legR.rotation.x = 0;
    this.armR.rotation.x = -2.4 + Math.sin(t * 6) * 0.3;
    this.armR.rotation.z = -0.3;
    this.armL.rotation.x = 0;
    this.body.position.y = 0;
    this.body.rotation.x = 0;
  }

  poseIdle(t: number): void {
    this.legL.rotation.x = 0;
    this.legR.rotation.x = 0;
    this.armL.rotation.x = Math.sin(t * 1.3) * 0.05;
    this.armR.rotation.x = -Math.sin(t * 1.3) * 0.05;
    this.armL.rotation.z = 0.05;
    this.armR.rotation.z = -0.05;
    this.body.position.y = Math.sin(t * 1.7) * 0.005;
    this.body.rotation.x = 0;
  }

  /** Lying on the ground (0..1 = fall progress). */
  poseKnocked(f: number): void {
    this.body.rotation.x = (-Math.PI / 2) * f;
    this.body.position.y = 0.12 * f;
    this.armL.rotation.x = -1.4 * f;
    this.armR.rotation.x = -0.6 * f;
    this.legL.rotation.x = 0.3 * f;
    this.legR.rotation.x = -0.2 * f;
  }

  setDetail(near: boolean): void {
    for (const l of this.limbs) l.visible = near;
  }
}
