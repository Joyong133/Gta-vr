import type * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { tuning } from '../config/tuning';
import { angleDelta, clamp, DEG2RAD, makeRng, moveToward } from '../core/math';
import { PedModel } from '../npc/PedModel';
import { AICar } from '../traffic/AICar';
import type { Movers } from '../traffic/Movers';
import { OFFICER_PATROL, POLICE_PARKING } from '../world/CityLayout';
import { obbVsObb, toObbLocal, type Obb2 } from '../world/geom2d';
import type { LanePath, RoadNetwork } from '../world/RoadNetwork';
import type { StaticWorld } from '../world/StaticWorld';
import type { WantedSystem } from './WantedSystem';

export type PoliceState = 'idle' | 'patrol' | 'respond' | 'pursue' | 'search' | 'return';

const _loc = { x: 0, z: 0 };
const _push = { x: 0, z: 0 };
const _pos = { x: 0, z: 0 };
const _dir = { x: 0, z: 0 };

interface UnitBase {
  id: string;
  kind: 'car' | 'officer';
  state: PoliceState;
  sees: boolean;
  lastSeen: number;
  perceptionTimer: number;
  targetX: number;
  targetZ: number;
  searchTimer: number;
  distToPlayer: number;
  dispatchIndex: number;
}

export class PoliceCarUnit implements UnitBase {
  readonly kind = 'car' as const;
  state: PoliceState;
  sees = false;
  lastSeen = Infinity;
  perceptionTimer = Math.random() * 0.2;
  targetX = 0;
  targetZ = 0;
  searchTimer = 0;
  distToPlayer = Infinity;
  steer = 0;
  private pathTimer = 0;
  private path: number[] = [];
  private stuckTimer = 0;
  private reverseTimer = 0;
  private lastX = 0;
  private lastZ = 0;
  patrolLane: LanePath | null = null;
  desiredSpeed = 0;

  constructor(
    readonly id: string,
    readonly car: AICar,
    readonly home: { x: number; z: number; yaw: number },
    readonly dispatchIndex: number,
    initial: PoliceState,
  ) {
    this.state = initial;
  }

  get x(): number {
    return this.car.x;
  }
  get z(): number {
    return this.car.z;
  }
  get yaw(): number {
    return this.car.yaw;
  }

  fixedDrive(h: number, roads: RoadNetwork, world: StaticWorld, others: Obb2[]): void {
    const car = this.car;
    if (this.state === 'idle') {
      car.speed = moveToward(car.speed, 0, 10 * h);
      this.integrate(h, 0, world, others);
      return;
    }
    // --- choose an aim point
    let aimX = this.targetX;
    let aimZ = this.targetZ;
    if (this.state === 'patrol') {
      if (!this.patrolLane) {
        this.patrolLane = roads.nearestLanePoint(car.x, car.z).lane;
      }
      const end = this.patrolLane.points[this.patrolLane.points.length - 1];
      if (Math.hypot(end.x - car.x, end.z - car.z) < 7) {
        const turns = this.patrolLane.next;
        const turn = turns[Math.floor(Math.random() * turns.length)];
        this.patrolLane = turn?.next[0] ?? roads.nearestLanePoint(car.x, car.z).lane;
      }
      const e2 = this.patrolLane.points[this.patrolLane.points.length - 1];
      aimX = e2.x;
      aimZ = e2.z;
    } else if (!this.directClear(world, aimX, aimZ)) {
      this.pathTimer -= h;
      if (this.pathTimer <= 0 || this.path.length === 0) {
        this.pathTimer = 1;
        const from = roads.nearestNode(car.x, car.z).id;
        const to = roads.nearestNode(this.targetX, this.targetZ).id;
        this.path = roads.findPath(from, to);
      }
      while (this.path.length > 0) {
        const n = roads.nodes[this.path[0]];
        if (Math.hypot(n.x - car.x, n.z - car.z) < 8 && this.path.length > 1) this.path.shift();
        else break;
      }
      if (this.path.length > 0) {
        const n = roads.nodes[this.path[0]];
        aimX = n.x;
        aimZ = n.z;
      }
    }

    // --- steering toward aim
    const targetYaw = Math.atan2(-(aimX - car.x), -(aimZ - car.z));
    const err = angleDelta(car.yaw, targetYaw);
    let steer = clamp(err * 1.8, -0.62, 0.62);
    let v = this.desiredSpeed * clamp(1 - Math.abs(err) / 1.7, 0.3, 1);
    // Static obstacle feelers
    const feel = 3 + Math.abs(car.speed) * 0.7;
    const f = this.feeler(world, 0, feel);
    if (f < feel) {
      v = Math.min(v, Math.max(2, f * 1.1));
      const l = this.feeler(world, 0.6, feel);
      const r = this.feeler(world, -0.6, feel);
      steer = clamp(steer + (l > r ? 0.5 : -0.5), -0.62, 0.62);
    }
    // Cars ahead
    for (const o of others) {
      toObbLocal(car.obb, o.cx, o.cz, _loc);
      const fwd = -_loc.z;
      if (fwd > 0 && fwd < 10 && Math.abs(_loc.x) < 2) v = Math.min(v, Math.max(0, (fwd - 5) * 1.2));
    }
    // Reverse out when stuck
    if (this.reverseTimer > 0) {
      this.reverseTimer -= h;
      v = -4;
      steer = -steer;
    } else if (this.desiredSpeed > 2) {
      const moved = Math.hypot(car.x - this.lastX, car.z - this.lastZ);
      if (moved < 0.02) this.stuckTimer += h;
      else this.stuckTimer = Math.max(0, this.stuckTimer - h);
      if (this.stuckTimer > 1.5) {
        this.stuckTimer = 0;
        this.reverseTimer = 1.2;
      }
    }
    this.lastX = car.x;
    this.lastZ = car.z;
    this.steer = moveToward(this.steer, steer, 3 * h);
    const accel = Math.abs(v) > Math.abs(car.speed) ? 6 : 10;
    car.speed = moveToward(car.speed, v, accel * h);
    this.integrate(h, this.steer, world, others);
  }

  private integrate(h: number, steer: number, world: StaticWorld, others: Obb2[]): void {
    const car = this.car;
    car.yaw += (car.speed / 2.7) * Math.tan(steer) * h;
    car.x += -Math.sin(car.yaw) * car.speed * h;
    car.z += -Math.cos(car.yaw) * car.speed * h;
    const obb: Obb2 = { cx: car.x, cz: car.z, yaw: car.yaw, halfW: 0.95, halfL: 2.25 };
    if (world.resolveObb(obb, _push)) {
      car.x = obb.cx;
      car.z = obb.cz;
      car.speed *= 0.7;
    }
    for (const o of others) {
      if (obbVsObb(obb, o, _push)) {
        car.x += _push.x * 0.5;
        car.z += _push.z * 0.5;
        obb.cx = car.x;
        obb.cz = car.z;
      }
    }
    car.setBraking(car.speed < 0.5);
  }

  /** Clear straight drive to the point? (three parallel rays at bumper height) */
  private directClear(world: StaticWorld, tx: number, tz: number): boolean {
    const car = this.car;
    const dx = tx - car.x;
    const dz = tz - car.z;
    const len = Math.hypot(dx, dz);
    if (len < 4) return true;
    const ux = dx / len;
    const uz = dz / len;
    for (const off of [-1.1, 0, 1.1]) {
      const ox = car.x + -uz * off;
      const oz = car.z + ux * off;
      if (world.raycast(ox, 0.8, oz, ux, 0, uz, len, carBlocker)) return false;
    }
    return true;
  }

  private feeler(world: StaticWorld, angle: number, len: number): number {
    const car = this.car;
    const yaw = car.yaw + angle;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const sign = car.speed >= 0 ? 1 : -1;
    const ox = car.x + fx * 2.2 * sign;
    const oz = car.z + fz * 2.2 * sign;
    const hit = world.raycast(ox, 0.8, oz, fx * sign, 0, fz * sign, len, carBlocker);
    return hit ? hit.t : Infinity;
  }
}

const carBlocker = (b: { blocksCars: boolean; maxY: number; minY: number }): boolean => b.blocksCars && b.maxY > 0.3 && b.minY < 1.5;

export class OfficerUnit implements UnitBase {
  readonly kind = 'officer' as const;
  state: PoliceState;
  sees = false;
  lastSeen = Infinity;
  perceptionTimer = Math.random() * 0.2;
  targetX = 0;
  targetZ = 0;
  searchTimer = 0;
  distToPlayer = Infinity;
  x: number;
  z: number;
  yaw = 0;
  speed = 0;
  patrolIndex = 0;
  stunned = 0;

  constructor(
    readonly id: string,
    readonly model: PedModel,
    readonly home: { x: number; z: number; yaw: number },
    readonly dispatchIndex: number,
    initial: PoliceState,
  ) {
    this.state = initial;
    this.x = home.x;
    this.z = home.z;
    this.yaw = home.yaw;
  }

  update(dt: number, world: StaticWorld, movers: Movers, obstacles: Obb2[], time: number): void {
    let tx = this.x;
    let tz = this.z;
    let speed = 0;
    if (this.stunned > 0) {
      this.stunned -= dt;
      this.model.poseKnocked(Math.min(1, (2.5 - this.stunned) * 4));
      this.place();
      return;
    }
    switch (this.state) {
      case 'idle':
        break;
      case 'patrol': {
        const p = OFFICER_PATROL[this.patrolIndex];
        tx = p.x;
        tz = p.z;
        speed = 1.3;
        if (Math.hypot(p.x - this.x, p.z - this.z) < 0.8) this.patrolIndex = (this.patrolIndex + 1) % OFFICER_PATROL.length;
        break;
      }
      case 'pursue':
        tx = movers.playerX;
        tz = movers.playerZ;
        speed = tuning.police.officerRunSpeed;
        if (Math.hypot(tx - this.x, tz - this.z) < 1.1) speed = 0;
        break;
      case 'respond':
      case 'search':
        tx = this.targetX;
        tz = this.targetZ;
        speed = this.state === 'respond' ? tuning.police.officerRunSpeed : 2.4;
        break;
      case 'return':
        tx = this.home.x;
        tz = this.home.z;
        speed = 1.6;
        if (Math.hypot(tx - this.x, tz - this.z) < 1) {
          this.state = this.dispatchIndex === 0 ? 'patrol' : 'idle';
          this.yaw = this.home.yaw;
        }
        break;
    }
    const dx = tx - this.x;
    const dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (speed > 0 && d > 0.3) {
      const ux = dx / d;
      const uz = dz / d;
      this.yaw += angleDelta(this.yaw, Math.atan2(-ux, -uz)) * Math.min(1, dt * 8);
      const p = { x: this.x + ux * speed * dt, z: this.z + uz * speed * dt };
      world.resolveCircle(p, 0.3);
      for (const o of obstacles) {
        // circle vs car footprint
        toObbLocal(o, p.x, p.z, _loc);
        if (Math.abs(_loc.x) < o.halfW + 0.3 && Math.abs(_loc.z) < o.halfL + 0.3) {
          const px = o.halfW + 0.3 - Math.abs(_loc.x);
          const pz = o.halfL + 0.3 - Math.abs(_loc.z);
          if (px < pz) _loc.x += Math.sign(_loc.x || 1) * px;
          else _loc.z += Math.sign(_loc.z || 1) * pz;
          const c = Math.cos(o.yaw);
          const s = Math.sin(o.yaw);
          p.x = o.cx + c * _loc.x + s * _loc.z;
          p.z = o.cz + -s * _loc.x + c * _loc.z;
        }
      }
      this.speed = Math.hypot(p.x - this.x, p.z - this.z) / Math.max(dt, 1e-4);
      this.x = p.x;
      this.z = p.z;
      this.model.body.rotation.x = 0;
      this.model.animateWalk(dt, this.speed);
    } else {
      this.speed = 0;
      if (this.state === 'pursue') {
        this.yaw += angleDelta(this.yaw, Math.atan2(-(movers.playerX - this.x), -(movers.playerZ - this.z))) * Math.min(1, dt * 6);
        this.model.poseWave(time);
      } else this.model.poseIdle(time);
    }
    this.place();
  }

  private place(): void {
    this.model.root.position.set(this.x, 0, this.z);
    this.model.root.rotation.y = this.yaw;
  }
}

export type PoliceUnit = PoliceCarUnit | OfficerUnit;

/**
 * Police: dispatch by wanted level, perception (range + FOV + line of sight),
 * pursuit, last-known-position search, return to patrol, sirens and arrests.
 */
export class PoliceManager {
  readonly cars: PoliceCarUnit[] = [];
  readonly officers: OfficerUnit[] = [];
  readonly group = new THREE.Group();
  private readonly rng = makeRng(31337);
  private time = 0;
  arrestProgress = 0;
  private readonly obstacles: Obb2[] = [];
  /** Player state, supplied each frame. */
  playerY = 1.6;
  playerInCar = false;
  playerSpeed = 0;
  onBusted?: () => void;
  onSighting?: (unit: PoliceUnit) => void;

  constructor(
    scene: THREE.Scene,
    world: CANNON.World,
    private readonly roads: RoadNetwork,
    private readonly staticWorld: StaticWorld,
    private readonly movers: Movers,
    private readonly wanted: WantedSystem,
  ) {
    this.group.name = 'Police';
    // Car 0 patrols; cars 1-2 wait at the precinct until dispatched.
    const patrolLane = roads.roadLanes[2];
    roads.sample(patrolLane, patrolLane.length * 0.5, _pos, _dir);
    const homes = [
      { x: _pos.x, z: _pos.z, yaw: Math.atan2(-_dir.x, -_dir.z) },
      { x: POLICE_PARKING[0].x, z: POLICE_PARKING[0].z, yaw: POLICE_PARKING[0].yaw },
      { x: POLICE_PARKING[1].x, z: POLICE_PARKING[1].z, yaw: POLICE_PARKING[1].yaw },
    ];
    homes.forEach((home, i) => {
      const car = new AICar(scene, world, `police_car_${i}`, 'police', 0x14161c);
      car.setPose(home.x, home.z, home.yaw);
      const unit = new PoliceCarUnit(`police_car_${i}`, car, home, i, i === 0 ? 'patrol' : 'idle');
      if (i === 0) unit.patrolLane = patrolLane;
      this.cars.push(unit);
    });
    const officerHomes = [
      { x: OFFICER_PATROL[0].x, z: OFFICER_PATROL[0].z, yaw: 0 },
      { x: 67, z: 102.5, yaw: 0 },
    ];
    officerHomes.forEach((home, i) => {
      const model = new PedModel({ shirt: 0x1d2a5a, pants: 0x141a33, skin: i ? 0x8d5524 : 0xe0ac69, hair: 0x1b1b1b, hat: 0x101530, accent: 0xffd23f, height: 1.04 });
      this.group.add(model.root);
      this.officers.push(new OfficerUnit(`officer_${i}`, model, home, i, i === 0 ? 'patrol' : 'idle'));
    });
  }

  get units(): PoliceUnit[] {
    return [...this.cars, ...this.officers];
  }

  /** Can any unit see a world point right now? (crime witnessing) */
  witnesses(x: number, z: number): boolean {
    for (const u of this.units) {
      if (this.canSee(u, x, 1.2, z, tuning.police.sightRange[1])) return true;
    }
    return false;
  }

  private unitPose(u: PoliceUnit): { x: number; z: number; yaw: number; eye: number } {
    if (u.kind === 'car') return { x: u.car.x, z: u.car.z, yaw: u.car.yaw, eye: 1.3 };
    return { x: u.x, z: u.z, yaw: u.yaw, eye: 1.65 };
  }

  private canSee(u: PoliceUnit, x: number, y: number, z: number, range: number): boolean {
    const p = this.unitPose(u);
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > range) return false;
    if (d > tuning.police.proximityAwareness) {
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      const cos = (fx * dx + fz * dz) / Math.max(d, 1e-4);
      if (cos < Math.cos((tuning.police.sightFovDeg / 2) * DEG2RAD)) return false;
    }
    return !this.staticWorld.isSightBlocked(p.x, p.eye, p.z, x, y, z);
  }

  private dispatchCount(kind: 'car' | 'officer'): number {
    const l = this.wanted.level;
    if (l === 0) return 0;
    return kind === 'car' ? l : l >= 2 ? 2 : 1;
  }

  /** Per render frame: perception + state machine + officers + visuals. */
  update(dt: number, viewer: THREE.Vector3): void {
    this.time += dt;
    const w = this.wanted;
    const px = this.movers.playerX;
    const pz = this.movers.playerZ;
    const range = tuning.police.sightRange[Math.max(1, w.level)];
    this.movers.carObbs(undefined, this.obstacles);

    for (const u of this.units) {
      const pose = this.unitPose(u);
      u.distToPlayer = Math.hypot(px - pose.x, pz - pose.z);
      u.perceptionTimer -= dt;
      if (u.perceptionTimer <= 0) {
        u.perceptionTimer = tuning.police.perceptionInterval;
        const stunned = u.kind === 'officer' && u.stunned > 0;
        u.sees = !stunned && w.level > 0 && this.canSee(u, px, this.playerInCar ? 1.0 : this.playerY, pz, range);
        if (u.sees) {
          u.lastSeen = 0;
          w.reportSighting(px, pz);
          this.onSighting?.(u);
        }
      }
      if (!u.sees) u.lastSeen += dt;
      this.decide(u, dt);
    }

    for (const o of this.officers) {
      const d2 = (o.x - viewer.x) ** 2 + (o.z - viewer.z) ** 2;
      o.model.root.visible = d2 < 150 * 150;
      o.model.setDetail(d2 < 55 * 55);
      o.update(dt, this.staticWorld, this.movers, this.obstacles, this.time);
    }
    for (const c of this.cars) {
      c.car.syncVisual(dt);
      const lb = c.car.visual.lightbar!;
      const flashing = c.state === 'respond' || c.state === 'pursue' || c.state === 'search';
      const phase = Math.floor(this.time * 6) % 2 === 0;
      lb.red.color.setHex(flashing && phase ? 0xff1a1a : 0x400000);
      lb.blue.color.setHex(flashing && !phase ? 0x1a4dff : 0x000a40);
    }
    this.updateArrest(dt);
  }

  private decide(u: PoliceUnit, dt: number): void {
    const w = this.wanted;
    const pt = tuning.police;
    if (w.level === 0) {
      if (u.state === 'respond' || u.state === 'pursue' || u.state === 'search') {
        u.state = 'return';
        u.targetX = u.home.x;
        u.targetZ = u.home.z;
      }
      if (u.kind === 'car') this.carReturnLogic(u);
      return;
    }
    const dispatched = u.dispatchIndex < this.dispatchCount(u.kind);
    if (u.sees) {
      u.state = 'pursue';
      u.targetX = this.movers.playerX;
      u.targetZ = this.movers.playerZ;
    } else if (u.state === 'pursue' && u.lastSeen > pt.lostSightTime) {
      u.state = 'search';
      u.targetX = w.lkpX;
      u.targetZ = w.lkpZ;
      u.searchTimer = 8;
    } else if ((u.state === 'idle' || u.state === 'patrol' || u.state === 'return') && dispatched && w.hasLkp) {
      u.state = 'respond';
      u.targetX = w.lkpX;
      u.targetZ = w.lkpZ;
    } else if (u.state === 'respond') {
      u.targetX = w.lkpX;
      u.targetZ = w.lkpZ;
      if (Math.hypot(u.targetX - this.unitPose(u).x, u.targetZ - this.unitPose(u).z) < 10) {
        u.state = 'search';
        u.searchTimer = 0;
      }
    } else if (u.state === 'search') {
      const p = this.unitPose(u);
      u.searchTimer -= dt;
      if (u.searchTimer <= 0 || Math.hypot(u.targetX - p.x, u.targetZ - p.z) < 6) {
        // New random point inside the search area (police search, they do not know where you are).
        const r = w.searchRadius * Math.sqrt(this.rng());
        const a = this.rng() * Math.PI * 2;
        let sx = w.lkpX + Math.cos(a) * r;
        let sz = w.lkpZ + Math.sin(a) * r;
        if (u.kind === 'car') {
          const np = this.roads.nearestLanePoint(sx, sz);
          sx = np.pos.x;
          sz = np.pos.z;
        }
        u.targetX = sx;
        u.targetZ = sz;
        u.searchTimer = 7 + this.rng() * 4;
      }
    }
    if (u.kind === 'car') {
      const lvl = Math.max(1, w.level);
      if (u.state === 'pursue') {
        let v = pt.carPursuitSpeed[lvl];
        if (u.distToPlayer < 14) v = Math.min(v, Math.max(0, this.playerSpeed * 0.95 + (u.distToPlayer - 6) * 0.9));
        u.desiredSpeed = v;
      } else if (u.state === 'respond') u.desiredSpeed = pt.carPursuitSpeed[lvl] * 0.85;
      else if (u.state === 'search') u.desiredSpeed = 9;
      else if (u.state === 'patrol') u.desiredSpeed = pt.carPatrolSpeed;
    }
  }

  private carReturnLogic(u: PoliceCarUnit): void {
    if (u.state === 'return') {
      u.desiredSpeed = 9;
      if (Math.hypot(u.home.x - u.car.x, u.home.z - u.car.z) < 6) {
        if (u.dispatchIndex === 0) {
          u.state = 'patrol';
          u.patrolLane = null;
        } else {
          u.state = 'idle';
          u.car.setPose(u.home.x, u.home.z, u.home.yaw);
        }
      }
      if (u.dispatchIndex === 0 && u.state === 'return') {
        // Patrol car simply resumes patrol from where it is.
        u.state = 'patrol';
        u.patrolLane = null;
      }
    } else if (u.state === 'patrol') u.desiredSpeed = tuning.police.carPatrolSpeed;
  }

  /** Physics sub-step for police cars. */
  fixedUpdate(h: number): void {
    const others = this.fixedOthers;
    for (const c of this.cars) {
      others.length = 0;
      for (const m of this.movers.cars) if (m.id !== c.id && m.kind !== 'player_car') others.push(m.obb);
      c.fixedDrive(h, this.roads, this.staticWorld, others);
      c.car.commitStep(h);
    }
  }

  private readonly fixedOthers: Obb2[] = [];

  publish(): void {
    for (const c of this.cars) this.movers.cars.push({ id: c.id, kind: 'police', obb: c.car.obb, speed: Math.abs(c.car.speed) });
    for (const o of this.officers) this.movers.walkers.push({ x: o.x, z: o.z, r: 0.3 });
  }

  private updateArrest(dt: number): void {
    const pt = tuning.police;
    let arresting = false;
    if (this.wanted.level > 0) {
      if (!this.playerInCar) {
        for (const o of this.officers) {
          if (o.state === 'pursue' && o.stunned <= 0 && o.distToPlayer < pt.arrestDistance) arresting = true;
        }
        if (arresting) this.arrestProgress += dt / pt.arrestTime;
      } else if (this.playerSpeed < 1.5) {
        for (const c of this.cars) {
          if (c.state === 'pursue' && c.distToPlayer < pt.carArrestDistance + 2) arresting = true;
        }
        if (arresting) this.arrestProgress += dt / pt.carArrestTime;
      }
    }
    if (!arresting) this.arrestProgress = Math.max(0, this.arrestProgress - dt * 0.8);
    if (this.arrestProgress >= 1) {
      this.arrestProgress = 0;
      this.onBusted?.();
    }
  }

  /** Puts every unit back to its default posture (after busted / load). */
  resetAll(): void {
    for (const c of this.cars) {
      c.state = c.dispatchIndex === 0 ? 'patrol' : 'idle';
      c.car.speed = 0;
      c.car.setPose(c.home.x, c.home.z, c.home.yaw);
      c.patrolLane = null;
    }
    for (const o of this.officers) {
      o.state = o.dispatchIndex === 0 ? 'patrol' : 'idle';
      o.x = o.home.x;
      o.z = o.home.z;
      o.stunned = 0;
    }
    this.arrestProgress = 0;
  }

  /** Units that should sound sirens, nearest first (audio limits the count). */
  sirenUnits(viewer: THREE.Vector3): PoliceCarUnit[] {
    return this.cars
      .filter((c) => c.state === 'respond' || c.state === 'pursue' || c.state === 'search')
      .sort((a, b) => (a.car.x - viewer.x) ** 2 + (a.car.z - viewer.z) ** 2 - ((b.car.x - viewer.x) ** 2 + (b.car.z - viewer.z) ** 2));
  }

  officerHitTest(x: number, y: number, z: number, r: number): OfficerUnit | null {
    for (const o of this.officers) {
      if (o.stunned > 0) continue;
      if (Math.hypot(o.x - x, o.z - z) < 0.32 + r && y > 0 && y < 1.9) return o;
    }
    return null;
  }

  /** Car vs officer contacts. */
  checkCarHits(car: Obb2, speed: number): OfficerUnit | null {
    for (const o of this.officers) {
      if (o.stunned > 0) continue;
      toObbLocal(car, o.x, o.z, _loc);
      if (Math.abs(_loc.x) < car.halfW + 0.3 && Math.abs(_loc.z) < car.halfL + 0.3) {
        if (speed > 3) {
          o.stunned = 2.5;
          return o;
        }
      }
    }
    return null;
  }
}
