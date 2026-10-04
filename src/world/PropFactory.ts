import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { COL, MASK } from '../config/layers';
import { Grabbable } from '../interaction/Grabbable';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

/**
 * Creates dynamic, grabbable physics props (visual + cannon body + Grabbable).
 * Every prop gets its own material instances so hover highlight works per object.
 */
export class PropFactory {
  private counter = 0;
  readonly created: Grabbable[] = [];

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly physics: PhysicsWorld,
  ) {}

  private body(mass: number, shape: CANNON.Shape, pos: THREE.Vector3, offset?: CANNON.Vec3): CANNON.Body {
    const b = new CANNON.Body({
      mass,
      material: this.physics.propMaterial,
      collisionFilterGroup: COL.PROP,
      collisionFilterMask: MASK.PROP,
      linearDamping: 0.05,
      angularDamping: 0.2,
      allowSleep: true,
      sleepSpeedLimit: 0.15,
      sleepTimeLimit: 0.8,
    });
    b.addShape(shape, offset);
    b.position.set(pos.x, pos.y, pos.z);
    this.physics.world.addBody(b);
    return b;
  }

  private finish(g: Grabbable): Grabbable {
    this.created.push(g);
    return g;
  }

  trashCan(pos: THREE.Vector3): Grabbable {
    const group = new THREE.Group();
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.23, 0.8, 12), new THREE.MeshLambertMaterial({ color: 0x2f6b4f }));
    bin.position.y = 0;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.06, 12), new THREE.MeshLambertMaterial({ color: 0x24493a }));
    lid.position.y = 0.42;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.05, 12), new THREE.MeshLambertMaterial({ color: 0xd8e04a, emissive: 0x2a2a00 }));
    band.position.y = 0.2;
    group.add(bin, lid, band);
    for (const m of [bin, lid, band]) m.castShadow = true;
    group.position.copy(pos).setY(0.42);
    this.scene.add(group);
    const b = this.body(9, new CANNON.Box(new CANNON.Vec3(0.24, 0.42, 0.24)), group.position);
    return this.finish(
      new Grabbable({ id: `trash_${this.counter++}`, object: group, body: b, physics: this.physics, nearRadius: 0.3, twoHand: 'midpoint', tags: ['prop'] }),
    );
  }

  cone(pos: THREE.Vector3): Grabbable {
    const group = new THREE.Group();
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.62, 12), new THREE.MeshLambertMaterial({ color: 0xff6a1a, emissive: 0x331000 }));
    c.position.y = 0.03;
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.12, 0.1, 12), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }));
    stripe.position.y = 0.06;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.4), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    base.position.y = -0.27;
    group.add(c, stripe, base);
    c.castShadow = true;
    group.position.copy(pos).setY(0.3);
    this.scene.add(group);
    const b = this.body(2, new CANNON.Box(new CANNON.Vec3(0.18, 0.3, 0.18)), group.position);
    return this.finish(new Grabbable({ id: `cone_${this.counter++}`, object: group, body: b, physics: this.physics, nearRadius: 0.2, tags: ['prop'] }));
  }

  crate(pos: THREE.Vector3, size = 0.6): Grabbable {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshLambertMaterial({ color: 0x8a6a3e }));
    const edges = new THREE.Mesh(
      new THREE.BoxGeometry(size * 1.02, size * 0.12, size * 1.02),
      new THREE.MeshLambertMaterial({ color: 0x5a4126 }),
    );
    const group = new THREE.Group();
    group.add(mesh, edges);
    mesh.castShadow = true;
    group.position.copy(pos).setY(size / 2);
    this.scene.add(group);
    const b = this.body(12, new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2)), group.position);
    return this.finish(
      new Grabbable({ id: `crate_${this.counter++}`, object: group, body: b, physics: this.physics, nearRadius: size * 0.6, twoHand: 'midpoint', tags: ['prop'] }),
    );
  }

  sodaCan(pos: THREE.Vector3, color: number): Grabbable {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.12, 12), new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.15) }));
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.005, 12), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
    top.position.y = 0.062;
    const group = new THREE.Group();
    group.add(mesh, top);
    group.position.copy(pos);
    this.scene.add(group);
    const b = this.body(0.35, new CANNON.Cylinder(0.033, 0.033, 0.12, 8), group.position);
    return this.finish(new Grabbable({ id: `can_${this.counter++}`, object: group, body: b, physics: this.physics, nearRadius: 0.07, farRadius: 0.12, tags: ['prop', 'can'] }));
  }

  /** Mission parcel. Works with one hand; a second hand steadies it (midpoint). */
  parcel(itemId: string, pos: THREE.Vector3): Grabbable {
    const group = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.32), new THREE.MeshLambertMaterial({ color: 0xc89b62 }));
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.265, 0.06), new THREE.MeshLambertMaterial({ color: 0x3df5ff, emissive: 0x0b4a52 }));
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.005, 0.1), new THREE.MeshBasicMaterial({ color: 0xff4fd8 }));
    label.position.set(0.1, 0.133, 0.06);
    group.add(box, tape, label);
    box.castShadow = true;
    group.position.copy(pos);
    this.scene.add(group);
    const b = this.body(3, new CANNON.Box(new CANNON.Vec3(0.21, 0.13, 0.16)), group.position);
    return this.finish(
      new Grabbable({ id: itemId, itemId, object: group, body: b, physics: this.physics, nearRadius: 0.22, twoHand: 'midpoint', tags: ['mission', 'parcel'] }),
    );
  }

  dataChip(itemId: string, pos: THREE.Vector3): Grabbable {
    const group = new THREE.Group();
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.08), new THREE.MeshLambertMaterial({ color: 0x1b1b24, emissive: 0x050510 }));
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.024, 0.02), new THREE.MeshBasicMaterial({ color: 0xff3d6e, toneMapped: false }));
    glow.position.z = 0.025;
    const pins = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.022, 0.012), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    pins.position.set(0, 0, -0.035);
    group.add(chip, glow, pins);
    group.position.copy(pos);
    this.scene.add(group);
    const b = this.body(0.2, new CANNON.Box(new CANNON.Vec3(0.06, 0.012, 0.04)), group.position);
    return this.finish(
      new Grabbable({ id: itemId, itemId, object: group, body: b, physics: this.physics, nearRadius: 0.1, farRadius: 0.16, tags: ['mission', 'chip'] }),
    );
  }
}
