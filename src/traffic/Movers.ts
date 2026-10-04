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
 */
export class Movers {
  readonly cars: MovingCar[] = [];
  readonly walkers: Walker[] = [];
  playerX = 0;
  playerZ = 0;
  playerOnFoot = true;

  clear(): void {
    this.cars.length = 0;
    this.walkers.length = 0;
  }

  /** Obbs of all cars except `exceptId`. */
  carObbs(exceptId?: string, out: Obb2[] = []): Obb2[] {
    out.length = 0;
    for (const c of this.cars) if (c.id !== exceptId) out.push(c.obb);
    return out;
  }
}
