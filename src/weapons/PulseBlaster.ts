import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { COL, MASK } from '../config/layers';
import { bodyTags, type BodyTag } from '../core/events';
import { Pool } from '../core/Pool';
import { Grabbable } from '../interaction/Grabbable';
import type { InteractorHand } from '../interaction/InteractorHand';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { StaticWorld } from '../world/StaticWorld';

export interface BlasterHit {
  point: THREE.Vector3;
  kind: 'static' | 'body' | 'ped' | 'officer' | 'none';
  body?: CANNON.Body;
  tag?: BodyTag | null;
  target?: unknown;
}

export interface BlasterHooks {
  /** Living targets: return what was hit by a sphere at p (radius r). */
  hitLiving(p: THREE.Vector3, r: number): { kind: 'ped' | 'officer'; target: unknown } | null;
  onFire(origin: THREE.Vector3): void;
  onHit(hit: BlasterHit): void;
}

interface Bolt {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  active: boolean;
}

interface Spark {
  mesh: THREE.Mesh;
  life: number;
}

const _from = new CANNON.Vec3();
const _to = new CANNON.Vec3();
const _dir = new THREE.Vector3();
const _step = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * "VOLT PULSE" - a fictional, non-lethal neon stun blaster (the game's one weapon).
 * Grab with one hand (aims along the pointing ray), steady with the other hand
 * on the foregrip for two-handed aiming. Bolts are pooled.
 * Firing near people is a "risky action": civilians flee and may report it.
 */
export class PulseBlaster {
  readonly grabbable: Grabbable;
  readonly root = new THREE.Group();
  private readonly muzzle = new THREE.Object3D();
  private readonly bolts: Pool<Bolt>;
  private readonly sparks: Pool<Spark>;
  private readonly liveBolts: Bolt[] = [];
  private readonly liveSparks: Spark[] = [];
  private cooldown = 0;
  private readonly coreMat: THREE.MeshBasicMaterial;
  private charge = 0;
  /** Desktop: fire direction override (camera forward). */
  aimOverride: (() => { origin: THREE.Vector3; dir: THREE.Vector3 }) | null = null;

  constructor(
    scene: THREE.Scene,
    private readonly phys: PhysicsWorld,
    private readonly world: StaticWorld,
    private readonly hooks: BlasterHooks,
    spawn: THREE.Vector3,
  ) {
    // Model: grip below, body along -Z (barrel), glowing coil.
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.26), new THREE.MeshLambertMaterial({ color: 0x23263a }));
    body.position.set(0, 0.02, -0.07);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.11, 0.05), new THREE.MeshLambertMaterial({ color: 0x15161f }));
    grip.position.set(0, -0.045, 0.02);
    grip.rotation.x = 0.25;
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0x3df5ff, toneMapped: false });
    const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 12), this.coreMat);
    coil.rotation.x = Math.PI / 2;
    coil.position.set(0, 0.06, -0.08);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.1, 10), new THREE.MeshLambertMaterial({ color: 0x8a90a6 }));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.025, -0.24);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.06), new THREE.MeshLambertMaterial({ color: 0xff4fd8, emissive: 0x330a2a }));
    fore.position.set(0, -0.025, -0.15);
    this.muzzle.position.set(0, 0.025, -0.3);
    this.root.add(body, grip, coil, barrel, fore, this.muzzle);
    this.root.position.copy(spawn);
    scene.add(this.root);

    const cbody = new CANNON.Body({ mass: 1.2, material: this.phys.propMaterial, collisionFilterGroup: COL.PROP, collisionFilterMask: MASK.PROP });
    cbody.addShape(new CANNON.Box(new CANNON.Vec3(0.03, 0.05, 0.13)), new CANNON.Vec3(0, 0.0, -0.07));
    cbody.position.set(spawn.x, spawn.y, spawn.z);
    this.phys.world.addBody(cbody);

    this.grabbable = new Grabbable({
      id: 'volt_pulse',
      object: this.root,
      body: cbody,
      physics: this.phys,
      attach: { mode: 'snap', position: [0, -0.01, 0.03], rotationDeg: [0, 0, 0], alignToRay: true },
      twoHand: 'aim',
      secondaryAnchor: new THREE.Vector3(0, -0.025, -0.15),
      nearRadius: 0.15,
      tags: ['weapon'],
    });
    this.grabbable.verb = '블래스터 잡기';
    this.grabbable.onUse = (hand, down) => {
      if (down) this.fire(hand);
    };

    const boltGeo = new THREE.CapsuleGeometry(0.025, 0.35, 4, 8);
    boltGeo.rotateX(Math.PI / 2);
    const boltMat = new THREE.MeshBasicMaterial({ color: 0x9ff8ff, toneMapped: false });
    this.bolts = new Pool<Bolt>(12, () => {
      const mesh = new THREE.Mesh(boltGeo, boltMat);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, active: false };
    });
    const sparkGeo = new THREE.IcosahedronGeometry(0.12, 0);
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0x9ff8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.sparks = new Pool<Spark>(16, () => {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, life: 0 };
    });
  }

  fire(hand: InteractorHand | null): void {
    if (this.cooldown > 0) return;
    const bolt = this.bolts.acquire();
    if (!bolt) return;
    this.cooldown = 0.28;
    this.charge = 1;
    if (this.aimOverride) {
      const a = this.aimOverride();
      bolt.pos.copy(a.origin);
      _dir.copy(a.dir).normalize();
    } else {
      this.muzzle.getWorldPosition(bolt.pos);
      this.muzzle.getWorldQuaternion(_q);
      _dir.set(0, 0, -1).applyQuaternion(_q);
    }
    bolt.vel.copy(_dir).multiplyScalar(65);
    bolt.life = 1.2;
    bolt.active = true;
    bolt.mesh.visible = true;
    bolt.mesh.position.copy(bolt.pos);
    bolt.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), _dir);
    this.liveBolts.push(bolt);
    hand?.pulse(0.7, 60);
    if (this.grabbable.secondary) this.grabbable.secondary.pulse(0.4, 40);
    this.hooks.onFire(bolt.pos);
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.charge = Math.max(0, this.charge - dt * 3);
    this.coreMat.color.setRGB(0.24 + this.charge * 0.76, 0.96, 1);
    for (let i = this.liveBolts.length - 1; i >= 0; i--) {
      const b = this.liveBolts[i];
      b.life -= dt;
      _step.copy(b.vel).multiplyScalar(dt);
      const len = _step.length();
      const hit = this.trace(b.pos, _step, len);
      if (hit || b.life <= 0) {
        if (hit) {
          this.spark(hit.point);
          this.hooks.onHit(hit);
        }
        b.active = false;
        b.mesh.visible = false;
        this.liveBolts.splice(i, 1);
        this.bolts.release(b);
        continue;
      }
      b.pos.add(_step);
      b.mesh.position.copy(b.pos);
    }
    for (let i = this.liveSparks.length - 1; i >= 0; i--) {
      const s = this.liveSparks[i];
      s.life -= dt;
      s.mesh.scale.setScalar(1 + (0.35 - s.life) * 6);
      if (s.life <= 0) {
        s.mesh.visible = false;
        this.liveSparks.splice(i, 1);
        this.sparks.release(s);
      }
    }
  }

  private spark(p: THREE.Vector3): void {
    const s = this.sparks.acquire();
    if (!s) return;
    s.life = 0.35;
    s.mesh.position.copy(p);
    s.mesh.visible = true;
    s.mesh.scale.setScalar(1);
    this.liveSparks.push(s);
  }

  /** Swept segment test: living targets, static boxes, physics bodies. */
  private trace(from: THREE.Vector3, step: THREE.Vector3, len: number): BlasterHit | null {
    if (len <= 0) return null;
    _dir.copy(step).divideScalar(len);
    let best: BlasterHit | null = null;
    let bestT = len;
    // Living targets (sampled along the segment).
    const samples = Math.ceil(len / 0.25);
    for (let i = 1; i <= samples; i++) {
      const t = (i / samples) * len;
      _p.copy(from).addScaledVector(_dir, t);
      const living = this.hooks.hitLiving(_p, 0.12);
      if (living) {
        best = { point: _p.clone(), kind: living.kind, target: living.target };
        bestT = t;
        break;
      }
    }
    const sh = this.world.raycast(from.x, from.y, from.z, _dir.x, _dir.y, _dir.z, bestT);
    if (sh && sh.t < bestT) {
      bestT = sh.t;
      best = { point: from.clone().addScaledVector(_dir, sh.t), kind: 'static' };
    }
    _from.set(from.x, from.y, from.z);
    _to.set(from.x + _dir.x * bestT, from.y + _dir.y * bestT, from.z + _dir.z * bestT);
    // The player's own car is excluded so you can fire from the driver's seat.
    const bh = this.phys.raycastBodies(_from, _to, COL.PROP | COL.AI_CAR);
    if (bh && bh.body && bh.body !== this.grabbable.body) {
      const t = bh.distance;
      if (t < bestT) {
        best = { point: new THREE.Vector3(bh.hitPointWorld.x, bh.hitPointWorld.y, bh.hitPointWorld.z), kind: 'body', body: bh.body, tag: bodyTags.get(bh.body) ?? null };
        // Shove props.
        if (bh.body.type === CANNON.Body.DYNAMIC) {
          bh.body.applyImpulse(new CANNON.Vec3(_dir.x * 6, _dir.y * 6 + 2, _dir.z * 6), bh.hitPointWorld);
          bh.body.wakeUp();
        }
      }
    }
    return best;
  }
}
