import * as THREE from 'three';
import { tuning } from '../config/tuning';
import { angleDelta, makeRng, pick } from '../core/math';
import type { Movers } from '../traffic/Movers';
import { pedestrianRoutes } from '../world/CityLayout';
import { circleVsObb, toObbLocal, type Obb2 } from '../world/geom2d';
import type { StaticWorld } from '../world/StaticWorld';
import { PedModel, type PedLook } from './PedModel';

export type PedState = 'walk' | 'idle' | 'flee' | 'cower' | 'knocked' | 'getup';

const SHIRTS = [0xe74c3c, 0x3498db, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xecf0f1, 0x34495e, 0xff6ad5, 0x2ecc71, 0xd35400];
const PANTS = [0x2c3e50, 0x1b1b22, 0x4a3b2a, 0x34495e, 0x5d5d6b, 0x203050];
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const HAIR = [0x1b1b1b, 0x3b2a1a, 0x6b4e2a, 0xb5651d, 0xe0d0b0, 0xff4fd8];

const _push = { x: 0, z: 0 };
const _loc = { x: 0, z: 0 };

export class Pedestrian {
  state: PedState = 'walk';
  x = 0;
  z = 0;
  yaw = 0;
  speed = 0;
  private route: { x: number; z: number }[];
  private target = 0;
  private dir: 1 | -1 = 1;
  private timer = 0;
  private fleeX = 0;
  private fleeZ = 0;
  private blockedTime = 0;
  private lastX = 0;
  private lastZ = 0;
  private stateTime = 0;
  updateAccum = 0;
  readonly radius = 0.28;
  stuckTurnarounds = 0;

  constructor(
    readonly id: string,
    readonly model: PedModel,
    route: { x: number; z: number }[],
    startIndex: number,
    private readonly rng: () => number,
  ) {
    this.route = route;
    this.target = (startIndex + 1) % route.length;
    const p = route[startIndex];
    const q = route[this.target];
    const f = rng();
    this.x = p.x + (q.x - p.x) * f;
    this.z = p.z + (q.z - p.z) * f;
    this.dir = rng() < 0.5 ? 1 : -1;
    if (this.dir < 0) this.target = startIndex;
  }

  setState(s: PedState, time = 0): void {
    this.state = s;
    this.timer = time;
    this.stateTime = 0;
  }

  /** React to danger at (x,z). */
  scare(x: number, z: number, severity: number): void {
    if (this.state === 'knocked' || this.state === 'getup') return;
    const d = Math.hypot(this.x - x, this.z - z);
    if (d < 5 && severity > 1.5 && this.rng() < 0.5) {
      this.setState('cower', 2.5 + this.rng() * 2);
    } else {
      this.setState('flee', tuning.pedestrians.fleeTime * (0.7 + this.rng() * 0.6));
    }
    this.fleeX = x;
    this.fleeZ = z;
  }

  knockDown(fromX: number, fromZ: number): void {
    this.setState('knocked', tuning.pedestrians.knockedTime);
    this.fleeX = fromX;
    this.fleeZ = fromZ;
    // Fall away from the impact.
    this.yaw = Math.atan2(-(this.x - fromX), -(this.z - fromZ)) + Math.PI;
  }

  update(dt: number, world: StaticWorld, movers: Movers, obstacles: readonly Obb2[], walkers: readonly Pedestrian[], time: number): void {
    const t = tuning.pedestrians;
    this.stateTime += dt;
    let desiredX = 0;
    let desiredZ = 0;
    let speed = 0;
    switch (this.state) {
      case 'walk': {
        const wp = this.route[this.target];
        const dx = wp.x - this.x;
        const dz = wp.z - this.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) {
          this.target = (this.target + this.dir + this.route.length) % this.route.length;
          if (this.rng() < 0.25) this.setState('idle', 2 + this.rng() * 4);
        } else {
          desiredX = dx / d;
          desiredZ = dz / d;
          speed = t.walkSpeed;
        }
        break;
      }
      case 'idle':
        this.timer -= dt;
        if (this.timer <= 0) this.setState('walk');
        break;
      case 'flee': {
        this.timer -= dt;
        let ax = this.x - this.fleeX;
        let az = this.z - this.fleeZ;
        const d = Math.hypot(ax, az) || 1;
        ax /= d;
        az /= d;
        desiredX = ax;
        desiredZ = az;
        speed = t.runSpeed;
        if (this.timer <= 0) {
          this.rejoinRoute();
          this.setState('walk');
        }
        break;
      }
      case 'cower':
        this.timer -= dt;
        if (this.timer <= 0) this.setState('flee', t.fleeTime * 0.6);
        break;
      case 'knocked':
        this.timer -= dt;
        if (this.timer <= 0) this.setState('getup', 0.9);
        break;
      case 'getup':
        this.timer -= dt;
        if (this.timer <= 0) this.setState('flee', t.fleeTime * 0.5);
        break;
    }

    if (speed > 0) {
      // Local avoidance: other walkers + player + cars ahead.
      let ax = 0;
      let az = 0;
      for (const o of walkers) {
        if (o === this) continue;
        const dx = this.x - o.x;
        const dz = this.z - o.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 1.2 * 1.2 && d2 > 1e-4) {
          const d = Math.sqrt(d2);
          ax += (dx / d) * (1.2 - d);
          az += (dz / d) * (1.2 - d);
        }
      }
      if (movers.playerOnFoot) {
        const dx = this.x - movers.playerX;
        const dz = this.z - movers.playerZ;
        const d = Math.hypot(dx, dz);
        if (d < 1.6 && d > 1e-3) {
          // Step aside (to the right of the walking direction) rather than straight back.
          ax += (dx / d) * (1.6 - d) * 1.5 + -desiredZ * 0.6;
          az += (dz / d) * (1.6 - d) * 1.5 + desiredX * 0.6;
        }
      }
      const self: Obb2 = { cx: this.x, cz: this.z, yaw: this.yaw, halfW: 0.3, halfL: 0.3 };
      for (const o of obstacles) {
        toObbLocal(self, o.cx, o.cz, _loc);
        if (-_loc.z > 0 && -_loc.z < 3.5 && Math.abs(_loc.x) < 2.6) {
          const side = _loc.x > 0 ? -1 : 1;
          ax += -desiredZ * side * 0.9;
          az += desiredX * side * 0.9;
        }
      }
      desiredX += ax;
      desiredZ += az;
      const len = Math.hypot(desiredX, desiredZ) || 1;
      desiredX /= len;
      desiredZ /= len;
      const targetYaw = Math.atan2(-desiredX, -desiredZ);
      this.yaw += angleDelta(this.yaw, targetYaw) * Math.min(1, dt * 8);
      const nx = this.x + desiredX * speed * dt;
      const nz = this.z + desiredZ * speed * dt;
      const p = { x: nx, z: nz };
      world.resolveCircle(p, this.radius);
      for (const o of obstacles) if (circleVsObb(p.x, p.z, this.radius, o, _push)) {
        p.x += _push.x;
        p.z += _push.z;
      }
      this.x = p.x;
      this.z = p.z;
    }
    this.speed = Math.hypot(this.x - this.lastX, this.z - this.lastZ) / Math.max(dt, 1e-4);
    // Blocked path handling: turn around on the route after a while.
    if (this.state === 'walk' && speed > 0 && this.speed < 0.25) {
      this.blockedTime += dt;
      if (this.blockedTime > 2.5) {
        this.blockedTime = 0;
        this.dir = this.dir === 1 ? -1 : 1;
        this.target = (this.target + this.dir + this.route.length) % this.route.length;
        this.stuckTurnarounds++;
      }
    } else this.blockedTime = Math.max(0, this.blockedTime - dt);
    this.lastX = this.x;
    this.lastZ = this.z;

    // Visual
    const m = this.model;
    m.root.position.set(this.x, 0, this.z);
    m.root.rotation.y = this.yaw;
    switch (this.state) {
      case 'walk':
      case 'flee':
        m.body.rotation.x = 0;
        m.animateWalk(dt, this.speed);
        break;
      case 'idle':
        m.poseIdle(time);
        break;
      case 'cower':
        m.poseCower();
        break;
      case 'knocked':
        m.poseKnocked(Math.min(1, this.stateTime * 4));
        break;
      case 'getup':
        m.poseKnocked(Math.max(0, 1 - this.stateTime / 0.9));
        break;
    }
  }

  private rejoinRoute(): void {
    let best = 0;
    let bd = Infinity;
    this.route.forEach((p, i) => {
      const d = (p.x - this.x) ** 2 + (p.z - this.z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    this.target = best;
  }

  get canWitness(): boolean {
    return this.state !== 'knocked' && this.state !== 'getup';
  }
}

/**
 * Spawns pedestrians on sidewalk loops and the plaza, updates them with
 * distance-based rates (LOD for AI), and handles car hits and danger reactions.
 */
export class PedestrianManager {
  readonly peds: Pedestrian[] = [];
  readonly group = new THREE.Group();
  private readonly rng = makeRng(808);
  private time = 0;
  private readonly obstacles: Obb2[] = [];

  constructor(
    private readonly world: StaticWorld,
    private readonly movers: Movers,
  ) {
    this.group.name = 'Pedestrians';
    const routes = pedestrianRoutes();
    for (let i = 0; i < tuning.pedestrians.count; i++) {
      const route = routes[i % routes.length];
      const look: PedLook = {
        shirt: pick(this.rng, SHIRTS),
        pants: pick(this.rng, PANTS),
        skin: pick(this.rng, SKIN),
        hair: pick(this.rng, HAIR),
        height: 0.92 + this.rng() * 0.16,
      };
      const model = new PedModel(look);
      this.group.add(model.root);
      const ped = new Pedestrian(`ped_${i}`, model, route, Math.floor(this.rng() * route.length), this.rng);
      this.peds.push(ped);
    }
  }

  update(dt: number, viewer: THREE.Vector3): void {
    this.time += dt;
    const t = tuning.pedestrians;
    this.movers.carObbs(undefined, this.obstacles);
    for (const p of this.peds) {
      const dx = p.x - viewer.x;
      const dz = p.z - viewer.z;
      const d2 = dx * dx + dz * dz;
      const near = d2 < t.nearDistance * t.nearDistance;
      const visible = d2 < t.cullDistance * t.cullDistance;
      p.model.root.visible = visible;
      p.model.setDetail(d2 < 55 * 55);
      // Far pedestrians think at a lower rate.
      p.updateAccum += dt;
      const interval = near ? 0 : t.farUpdateInterval;
      if (p.updateAccum >= interval) {
        p.update(p.updateAccum, this.world, this.movers, this.obstacles, this.peds, this.time);
        p.updateAccum = 0;
      }
    }
  }

  publish(): void {
    for (const p of this.peds) {
      if (p.state === 'knocked') continue;
      this.movers.walkers.push({ x: p.x, z: p.z, r: p.radius });
    }
  }

  /** Everyone near a dangerous event reacts. */
  danger(x: number, z: number, radius: number, severity: number): void {
    for (const p of this.peds) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < radius) p.scare(x, z, severity * (1 - d / radius) * 2);
    }
  }

  /** Is there a civilian who can see (x,z)? */
  hasWitness(x: number, z: number, exclude?: Pedestrian): boolean {
    for (const p of this.peds) {
      if (p === exclude || !p.canWitness) continue;
      const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d2 > 32 * 32) continue;
      if (!this.world.isSightBlocked(p.x, 1.6, p.z, x, 1.2, z)) return true;
    }
    return false;
  }

  /** Car vs pedestrian contacts. Returns peds that were knocked down this frame. */
  checkCarHits(car: Obb2, carSpeed: number, out: Pedestrian[]): Pedestrian[] {
    out.length = 0;
    for (const p of this.peds) {
      if (p.state === 'knocked' || p.state === 'getup') continue;
      if (Math.abs(p.x - car.cx) > 4 || Math.abs(p.z - car.cz) > 4) continue;
      if (!circleVsObb(p.x, p.z, p.radius, car, _push)) continue;
      if (carSpeed > 3) {
        p.knockDown(car.cx, car.cz);
        p.x += _push.x * 1.5;
        p.z += _push.z * 1.5;
        out.push(p);
      } else {
        // Slow contact: just shove them aside.
        p.x += _push.x;
        p.z += _push.z;
        if (p.state === 'walk' || p.state === 'idle') p.scare(car.cx, car.cz, 0.5);
      }
    }
    return out;
  }

  stateCounts(): Record<PedState, number> {
    const c: Record<PedState, number> = { walk: 0, idle: 0, flee: 0, cower: 0, knocked: 0, getup: 0 };
    for (const p of this.peds) c[p.state]++;
    return c;
  }

  nearest(x: number, z: number, n: number): Pedestrian[] {
    return [...this.peds].sort((a, b) => (a.x - x) ** 2 + (a.z - z) ** 2 - ((b.x - x) ** 2 + (b.z - z) ** 2)).slice(0, n);
  }

  /** Projectile / blast hit test (sphere vs ped capsule). */
  hitTest(x: number, y: number, z: number, r: number): Pedestrian | null {
    for (const p of this.peds) {
      if (p.state === 'knocked') continue;
      if (Math.hypot(p.x - x, p.z - z) < p.radius + r && y > 0 && y < 1.85) return p;
    }
    return null;
  }
}
