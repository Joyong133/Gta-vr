import { tuning } from '../config/tuning';
import type { CrimeType } from '../core/events';
import type { WantedSystem } from './WantedSystem';

export interface WitnessSource {
  policeSees(x: number, z: number): boolean;
  civilianSees(x: number, z: number, exclude?: unknown): boolean;
}

interface PendingReport {
  type: CrimeType;
  x: number;
  z: number;
  time: number;
}

/**
 * Turns risky actions into wanted level - but only if someone saw them.
 *  police witness  -> immediate, exact location
 *  civilian witness -> reported after a delay (phone call), stale location
 *  nobody          -> nothing happens
 */
export class CrimeSystem {
  private readonly pending: PendingReport[] = [];
  /** Debug log of the last few crimes. */
  readonly log: string[] = [];
  onReported?: (type: CrimeType, witness: 'police' | 'civilian' | 'system') => void;

  constructor(
    private readonly wanted: WantedSystem,
    private readonly witnesses: WitnessSource,
  ) {}

  commit(type: CrimeType, x: number, z: number, victim?: unknown): 'police' | 'civilian' | 'none' | 'system' {
    if (type === 'alarm') {
      this.wanted.reportCrime(type, x, z, 'system');
      this.note(`${type} -> system`);
      this.onReported?.(type, 'system');
      return 'system';
    }
    if (this.witnesses.policeSees(x, z)) {
      this.wanted.reportCrime(type, x, z, 'police');
      this.note(`${type} -> police`);
      this.onReported?.(type, 'police');
      return 'police';
    }
    if (this.witnesses.civilianSees(x, z, victim)) {
      // Don't queue duplicate calls for the same kind of crime.
      if (!this.pending.some((p) => p.type === type)) this.pending.push({ type, x, z, time: tuning.police.civilianReportDelay });
      this.note(`${type} -> civilian call queued`);
      return 'civilian';
    }
    this.note(`${type} -> no witness`);
    return 'none';
  }

  update(dt: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.time -= dt;
      if (p.time <= 0) {
        this.pending.splice(i, 1);
        this.wanted.reportCrime(p.type, p.x, p.z, 'civilian');
        this.onReported?.(p.type, 'civilian');
      }
    }
  }

  clearPending(): void {
    this.pending.length = 0;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  private note(s: string): void {
    this.log.push(s);
    if (this.log.length > 5) this.log.shift();
  }
}
