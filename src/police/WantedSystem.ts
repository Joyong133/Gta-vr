import { tuning } from '../config/tuning';
import type { CrimeType, Witness } from '../core/events';

interface CrimeRule {
  /** Minimum wanted level when reported by civilians. */
  civilian: number;
  /** Minimum wanted level when witnessed by police (or system alarms). */
  police: number;
  /** Repeat offences seen by police raise the level by one. */
  escalate: boolean;
}

export const CRIME_RULES: Record<CrimeType, CrimeRule> = {
  hit_pedestrian: { civilian: 1, police: 2, escalate: true },
  assault_civilian: { civilian: 1, police: 2, escalate: true },
  shots_fired: { civilian: 1, police: 1, escalate: false },
  hit_police_vehicle: { civilian: 2, police: 2, escalate: true },
  assault_police: { civilian: 3, police: 3, escalate: true },
  alarm: { civilian: 2, police: 2, escalate: false },
};

export const MAX_WANTED = 3;

/**
 * Wanted level 0..3 driven by what the police actually know:
 *  - crimes set a last known position (LKP); police only learn the player's real
 *    position by seeing them (reportSighting)
 *  - after losing sight, police search around the LKP; staying unseen
 *    (faster outside the search radius) runs a cooldown that clears the level.
 */
export class WantedSystem {
  level = 0;
  lkpX = 0;
  lkpZ = 0;
  hasLkp = false;
  /** Seconds since any officer last saw the player. */
  timeSinceSeen = Infinity;
  /** Seconds accumulated toward losing the police. */
  cooldown = 0;
  private readonly crimeCooldown = new Map<CrimeType, number>();
  onChanged?: (level: number, prev: number) => void;
  onCleared?: (prevLevel: number) => void;

  get searching(): boolean {
    return this.level > 0 && this.timeSinceSeen > tuning.police.lostSightTime;
  }

  get searchRadius(): number {
    return tuning.police.searchRadius[this.level] ?? 0;
  }

  get cooldownDuration(): number {
    return tuning.police.cooldownTime[this.level] ?? 0;
  }

  get cooldownProgress(): number {
    const d = this.cooldownDuration;
    return d > 0 ? Math.min(1, this.cooldown / d) : 0;
  }

  /** Returns true if the crime changed the wanted level. */
  reportCrime(type: CrimeType, x: number, z: number, witness: Witness): boolean {
    const cd = this.crimeCooldown.get(type) ?? 0;
    if (cd > 0 && this.level > 0) {
      // Same offence spam (one long scrape, a burst of shots): only refresh the LKP.
      if (witness !== 'civilian') this.setLkp(x, z, true);
      return false;
    }
    this.crimeCooldown.set(type, 2.5);
    const rule = CRIME_RULES[type];
    const policeKnows = witness === 'police' || witness === 'system';
    const min = policeKnows ? rule.police : rule.civilian;
    let next = Math.max(this.level, min);
    if (rule.escalate && policeKnows && this.level > 0 && this.level >= min) next = this.level + 1;
    next = Math.min(MAX_WANTED, next);
    // Police witnesses / alarms pin the location; civilian calls give a stale location.
    this.setLkp(x, z, witness === 'police');
    if (witness !== 'police' && this.timeSinceSeen === Infinity) this.timeSinceSeen = tuning.police.lostSightTime + 0.01;
    this.cooldown = 0;
    return this.setLevel(next);
  }

  /** An officer can currently see the player at (x, z). */
  reportSighting(x: number, z: number): void {
    if (this.level === 0) return;
    this.setLkp(x, z, true);
    this.cooldown = 0;
  }

  private setLkp(x: number, z: number, seen: boolean): void {
    this.lkpX = x;
    this.lkpZ = z;
    this.hasLkp = true;
    if (seen) this.timeSinceSeen = 0;
  }

  setLevel(level: number): boolean {
    const prev = this.level;
    const next = Math.max(0, Math.min(MAX_WANTED, Math.floor(level)));
    if (next === prev) return false;
    this.level = next;
    if (next === 0) {
      this.hasLkp = false;
      this.timeSinceSeen = Infinity;
      this.cooldown = 0;
    }
    this.onChanged?.(next, prev);
    if (next === 0 && prev > 0) this.onCleared?.(prev);
    return true;
  }

  /** Mission scripting / debug: force a level with a known position. */
  force(level: number, x: number, z: number): void {
    this.setLkp(x, z, true);
    this.cooldown = 0;
    this.setLevel(level);
  }

  clear(): void {
    this.setLevel(0);
  }

  /**
   * Busted / restart / load: drop to 0 without the "escaped" onCleared callback
   * (onChanged still reports the level change).
   */
  reset(): void {
    const prev = this.level;
    this.level = 0;
    this.hasLkp = false;
    this.timeSinceSeen = Infinity;
    this.cooldown = 0;
    this.crimeCooldown.clear();
    if (prev !== 0) this.onChanged?.(0, prev);
  }

  update(dt: number, playerX: number, playerZ: number): void {
    for (const [k, v] of this.crimeCooldown) this.crimeCooldown.set(k, Math.max(0, v - dt));
    if (this.level === 0) return;
    if (this.timeSinceSeen !== Infinity) this.timeSinceSeen += dt;
    if (!this.searching) {
      this.cooldown = 0;
      return;
    }
    const inside = this.hasLkp && (playerX - this.lkpX) ** 2 + (playerZ - this.lkpZ) ** 2 < this.searchRadius ** 2;
    this.cooldown += dt * (inside ? tuning.police.insideRadiusCooldownRate : 1);
    if (this.cooldown >= this.cooldownDuration) this.clear();
  }
}
