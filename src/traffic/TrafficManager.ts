import type * as CANNON from 'cannon-es';
import type * as THREE from 'three';
import { tuning } from '../config/tuning';
import { clamp, makeRng, moveToward } from '../core/math';
import { toObbLocal } from '../world/geom2d';
import type { LanePath, RoadNetwork } from '../world/RoadNetwork';
import { AICar } from './AICar';
import type { Movers } from './Movers';

export type TrafficState = 'drive' | 'wait_light' | 'wait_junction' | 'blocked' | 'overtake' | 'stunned';

const COLORS = [0xc0392b, 0xe8e8ee, 0x2c3e50, 0xf1c40f, 0x8e44ad, 0x27ae60, 0x7f8c8d, 0xd35400, 0x16a085, 0x34495e];
const STOP_BACK = 3.8; // stop this far before the end of the lane (stop line)
const _loc = { x: 0, z: 0 };
const _pos = { x: 0, z: 0 };
const _dir = { x: 0, z: 0 };

/** Lane-following civilian car with a tiny state machine. */
export class TrafficCar {
  state: TrafficState = 'drive';
  lane: LanePath;
  s: number;
  offset = 0;
  targetOffset = 0;
  blockedTime = 0;
  stunnedTime = 0;
  honkCooldown = 0;
  /** Debug: what is limiting speed right now. */
  reason = '';
  private overtakeObstacleSpeed = 0;

  constructor(
    readonly car: AICar,
    lane: LanePath,
    s: number,
    private readonly rng: () => number,
  ) {
    this.lane = lane;
    this.s = s;
  }

  fixedUpdate(h: number, roads: RoadNetwork, movers: Movers, time: number, onHonk: (car: TrafficCar) => void): void {
    const t = tuning.traffic;
    const car = this.car;
    this.honkCooldown = Math.max(0, this.honkCooldown - h);
    if (this.state === 'stunned') {
      this.stunnedTime -= h;
      car.speed = moveToward(car.speed, 0, t.decel * h);
      if (this.stunnedTime <= 0) this.state = 'drive';
      this.advance(h, roads);
      return;
    }
    let target = this.lane.speedLimit > 0 ? Math.min(t.cruiseSpeed, this.lane.speedLimit) : t.cruiseSpeed;
    if (this.lane.kind === 'turn' && this.lane.points.length > 2) target = Math.min(target, t.turnSpeed);
    this.reason = 'cruise';
    let next: TrafficState = this.offset !== 0 || this.targetOffset !== 0 ? 'overtake' : 'drive';

    // Traffic light / junction at the end of a road lane.
    if (this.lane.kind === 'road') {
      const node = roads.nodes[this.lane.node];
      const distStop = this.lane.length - STOP_BACK - this.s;
      if (node.hasLight && distStop > -0.5) {
        const light = roads.lightState(node.id, this.lane.axis, time);
        const canStop = distStop > (car.speed * car.speed) / (2 * t.decel) - 0.5;
        if (light === 'red' || (light === 'yellow' && canStop)) {
          const v = Math.sqrt(2 * t.decel * 0.8 * Math.max(0, distStop));
          if (v < target) {
            target = v;
            this.reason = `light ${light}`;
            if (distStop < 6) next = 'wait_light';
          }
        }
      }
      // Junction occupancy: do not enter while a crossing car is inside.
      if (distStop < 3 && distStop > -1.5 && this.junctionBusy(roads, movers)) {
        target = Math.min(target, Math.sqrt(2 * t.decel * Math.max(0, distStop)));
        this.reason = 'junction busy';
        next = 'wait_junction';
      }
    }

    // Leader / obstacle ahead.
    const probe = 6 + car.speed * 1.6;
    const ahead = this.probe(movers, probe);
    if (ahead.dist < probe) {
      const gap = ahead.dist - t.minGap;
      const v = gap <= 0 ? 0 : Math.sqrt(2 * t.decel * 0.7 * gap) + Math.max(0, ahead.speed) * 0.8;
      if (v < target) {
        target = Math.max(0, v);
        this.reason = `${ahead.kind} ahead ${ahead.dist.toFixed(1)}m`;
      }
      if (ahead.dist < t.minGap + 2 && ahead.speed < 0.5 && next !== 'wait_light') {
        this.blockedTime += h;
        next = 'blocked';
        if (this.blockedTime > 2 && this.honkCooldown <= 0 && ahead.kind !== 'traffic') {
          this.honkCooldown = 3 + this.rng() * 2;
          onHonk(this);
        }
        if (this.blockedTime > t.blockedOvertakeTime && ahead.kind !== 'traffic' && this.lane.kind === 'road' && this.canOvertake(movers)) {
          this.targetOffset = -3.4;
          this.overtakeObstacleSpeed = ahead.speed;
          this.blockedTime = 0;
        }
      } else {
        this.blockedTime = Math.max(0, this.blockedTime - h);
      }
    } else {
      this.blockedTime = Math.max(0, this.blockedTime - h);
      if (this.targetOffset !== 0 && this.overtakeObstacleSpeed < 1) {
        // Obstacle passed (nothing ahead in the offset lane): merge back.
        const back = this.probeBehindClear(movers);
        if (back) this.targetOffset = 0;
      }
    }
    if (this.lane.kind === 'turn') this.targetOffset = 0;

    const accel = target > car.speed ? t.accel : t.decel;
    car.speed = moveToward(car.speed, target, accel * h);
    car.setBraking(target < car.speed - 0.5 || car.speed < 0.2);
    this.offset = moveToward(this.offset, this.targetOffset, 1.4 * h);
    this.state = next;
    this.advance(h, roads);
  }

  private advance(h: number, roads: RoadNetwork): void {
    const car = this.car;
    this.s += car.speed * h;
    while (this.s > this.lane.length) {
      this.s -= this.lane.length;
      const options = this.lane.next;
      this.lane = options.length ? options[Math.floor(this.rng() * options.length)] : this.lane;
      if (!options.length) this.s = 0;
    }
    roads.sample(this.lane, this.s, _pos, _dir);
    // Right normal of the travel direction: (-dz, dx)
    car.x = _pos.x + -_dir.z * this.offset;
    car.z = _pos.z + _dir.x * this.offset;
    car.yaw = Math.atan2(-_dir.x, -_dir.z);
  }

  /** Distance to the nearest thing in our path (straight probe). */
  private probe(movers: Movers, maxDist: number): { dist: number; speed: number; kind: string } {
    const self = this.car;
    let best = { dist: Infinity, speed: 0, kind: '' };
    for (const c of movers.cars) {
      if (c.id === self.id) continue;
      toObbLocal(self.obb, c.obb.cx, c.obb.cz, _loc);
      const fwd = -_loc.z;
      if (fwd <= 0 || fwd > maxDist + 4.5) continue;
      if (Math.abs(_loc.x) > 1.9) continue;
      // Ignore cars driving the opposite way (head-on in their own lane is filtered by lateral).
      const dist = fwd - 4.5;
      if (dist < best.dist) best = { dist: Math.max(0, dist), speed: c.speed, kind: c.kind === 'traffic' ? 'traffic' : c.kind };
    }
    for (const w of movers.walkers) {
      toObbLocal(self.obb, w.x, w.z, _loc);
      const fwd = -_loc.z;
      if (fwd <= 0 || fwd > maxDist + 2.3) continue;
      if (Math.abs(_loc.x) > 1.25 + w.r) continue;
      const dist = fwd - 2.3 - w.r;
      if (dist < best.dist) best = { dist: Math.max(0, dist), speed: 0, kind: 'walker' };
    }
    return best;
  }

  private canOvertake(movers: Movers): boolean {
    const self = this.car;
    for (const c of movers.cars) {
      if (c.id === self.id) continue;
      toObbLocal(self.obb, c.obb.cx, c.obb.cz, _loc);
      // Oncoming lane is ~6 m to our left.
      if (_loc.x < -2 && _loc.x > -9 && -_loc.z > -8 && -_loc.z < 35) return false;
    }
    return true;
  }

  private probeBehindClear(movers: Movers): boolean {
    const self = this.car;
    for (const c of movers.cars) {
      if (c.id === self.id) continue;
      toObbLocal(self.obb, c.obb.cx, c.obb.cz, _loc);
      if (_loc.x > 0 && _loc.x < 5 && Math.abs(_loc.z) < 6) return false;
    }
    for (const w of movers.walkers) {
      toObbLocal(self.obb, w.x, w.z, _loc);
      if (_loc.x > 0 && _loc.x < 5 && Math.abs(_loc.z) < 4) return false;
    }
    return true;
  }

  private junctionBusy(roads: RoadNetwork, movers: Movers): boolean {
    const n = roads.nodes[this.lane.node];
    const jh = roads.junctionHalf + 0.5;
    const myAxisX = this.lane.axis === 'ew';
    for (const c of movers.cars) {
      if (c.id === this.car.id) continue;
      if (Math.abs(c.obb.cx - n.x) > jh || Math.abs(c.obb.cz - n.z) > jh) continue;
      if (c.speed < 0.3 && c.kind === 'traffic') continue;
      const fx = Math.abs(Math.sin(c.obb.yaw));
      const crossing = myAxisX ? fx < 0.5 : fx > 0.5;
      if (crossing || c.kind !== 'traffic') return true;
    }
    return false;
  }

  stun(seconds: number): void {
    this.state = 'stunned';
    this.stunnedTime = seconds;
  }
}

/** Spawns and drives civilian traffic. */
export class TrafficManager {
  readonly cars: TrafficCar[] = [];
  private readonly rng = makeRng(4242);
  private time = 0;
  onHonk?: (car: TrafficCar) => void;

  constructor(
    scene: THREE.Scene,
    world: CANNON.World,
    private readonly roads: RoadNetwork,
    private readonly movers: Movers,
  ) {
    const lanes = roads.roadLanes;
    const count = tuning.traffic.count;
    for (let i = 0; i < count; i++) {
      const lane = lanes[(i * 5 + 3) % lanes.length];
      const s = clamp(lane.length * (0.25 + 0.5 * this.rng()), 6, lane.length - 12);
      const car = new AICar(scene, world, `traffic_${i}`, 'traffic', COLORS[i % COLORS.length]);
      const tc = new TrafficCar(car, lane, s, this.rng);
      roads.sample(lane, s, _pos, _dir);
      car.setPose(_pos.x, _pos.z, Math.atan2(-_dir.x, -_dir.z));
      car.speed = 4;
      this.cars.push(tc);
    }
  }

  /** Physics sub-step. */
  fixedUpdate(h: number, time: number): void {
    this.time = time;
    for (const c of this.cars) {
      c.fixedUpdate(h, this.roads, this.movers, time, (car) => this.onHonk?.(car));
      c.car.commitStep(h);
    }
  }

  syncVisuals(dt: number, viewer: THREE.Vector3): void {
    for (const c of this.cars) {
      c.car.syncVisual(dt);
      // Distance culling of far cars (they keep simulating).
      const dx = c.car.x - viewer.x;
      const dz = c.car.z - viewer.z;
      c.car.setVisible(dx * dx + dz * dz < 200 * 200);
    }
  }

  publish(): void {
    for (const c of this.cars) this.movers.cars.push({ id: c.car.id, kind: 'traffic', obb: c.car.obb, speed: c.car.speed });
  }

  byId(id: string): TrafficCar | undefined {
    return this.cars.find((c) => c.car.id === id);
  }

  get currentTime(): number {
    return this.time;
  }
}
