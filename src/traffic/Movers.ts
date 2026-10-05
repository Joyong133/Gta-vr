import type { Obb2 } from '../world/geom2d';

export type MoverKind = 'traffic' | 'police' | 'player_car';

export interface MovingCar {
  id: string;
  kind: MoverKind;
  obb: Obb2;
  speed: number;
}

export interface Walker {
  x: number;
  z: number;
  r: number;
}

/**
 * Snapshot of everything that moves, rebuilt once per frame.
 * AI queries this instead of searching the scene.
 * addCar / addWalker reuse pooled records, so rebuilding it allocates nothing;
 * records are only valid until the next clear().
 */
export class Movers {
  readonly cars: MovingCar[] = [];
  readonly walkers: Walker[] = [];
  playerX = 0;
  playerZ = 0;
  playerOnFoot = true;
  /** Pooled records, indexed by the slot they were appended to. */
  private readonly carPool: MovingCar[] = [];
  private readonly walkerPool: Walker[] = [];

  clear(): void {
    this.cars.length = 0;
    this.walkers.length = 0;
  }

  /** Appends a car using a pooled record (no per-frame allocation once warmed up). */
  addCar(id: string, kind: MoverKind, obb: Obb2, speed: number): void {
    const i = this.cars.length;
    let rec = this.carPool[i];
    if (rec) {
      rec.id = id;
      rec.kind = kind;
      rec.obb = obb;
      rec.speed = speed;
    } else {
      rec = { id, kind, obb, speed };
      this.carPool[i] = rec;
    }
    this.cars.push(rec);
  }

  /** Appends a walker using a pooled record. */
  addWalker(x: number, z: number, r: number): void {
    const i = this.walkers.length;
    let rec = this.walkerPool[i];
    if (rec) {
      rec.x = x;
      rec.z = z;
      rec.r = r;
    } else {
      rec = { x, z, r };
      this.walkerPool[i] = rec;
    }
    this.walkers.push(rec);
  }

  /** Obbs of all cars except `exceptId`. */
  carObbs(exceptId?: string, out: Obb2[] = []): Obb2[] {
    out.length = 0;
    for (const c of this.cars) if (c.id !== exceptId) out.push(c.obb);
    return out;
  }
}
