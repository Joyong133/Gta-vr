import { describe, expect, it } from 'vitest';
import { tuning } from '../../src/config/tuning';
import { WantedSystem } from '../../src/police/WantedSystem';

function run(w: WantedSystem, seconds: number, px: number, pz: number) {
  for (let t = 0; t < seconds; t += 0.1) w.update(0.1, px, pz);
}

describe('WantedSystem', () => {
  it('civilian report gives level 1 with a stale location, police start searching', () => {
    const w = new WantedSystem();
    expect(w.reportCrime('hit_pedestrian', 10, 10, 'civilian')).toBe(true);
    expect(w.level).toBe(1);
    expect(w.hasLkp).toBe(true);
    expect(w.searching).toBe(true); // nobody has actually seen the player
  });

  it('police witnesses give a higher level and escalate repeat offences', () => {
    const w = new WantedSystem();
    w.reportCrime('hit_pedestrian', 0, 0, 'police');
    expect(w.level).toBe(2);
    expect(w.searching).toBe(false);
    run(w, 3, 0, 0); // crime cooldown passes
    w.reportCrime('hit_pedestrian', 0, 0, 'police');
    expect(w.level).toBe(3);
    run(w, 3, 0, 0);
    w.reportCrime('hit_pedestrian', 0, 0, 'police');
    expect(w.level).toBe(3); // capped
  });

  it('repeated identical crime within the cooldown does not stack', () => {
    const w = new WantedSystem();
    w.reportCrime('shots_fired', 0, 0, 'civilian');
    w.reportCrime('shots_fired', 0, 0, 'civilian');
    w.reportCrime('shots_fired', 0, 0, 'civilian');
    expect(w.level).toBe(1);
  });

  it('clears after staying unseen outside the search radius', () => {
    const w = new WantedSystem();
    let cleared = 0;
    w.onCleared = () => cleared++;
    w.force(2, 0, 0);
    const far = tuning.police.searchRadius[2] + 20;
    run(w, tuning.police.lostSightTime + 0.2, far, 0);
    expect(w.searching).toBe(true);
    run(w, tuning.police.cooldownTime[2] + 0.5, far, 0);
    expect(w.level).toBe(0);
    expect(cleared).toBe(1);
  });

  it('a sighting resets the cooldown (police know where you are again)', () => {
    const w = new WantedSystem();
    w.force(1, 0, 0);
    run(w, tuning.police.lostSightTime + 3, 200, 0);
    expect(w.cooldown).toBeGreaterThan(0);
    w.reportSighting(150, 0);
    expect(w.cooldown).toBe(0);
    expect(w.searching).toBe(false);
    expect(w.lkpX).toBe(150);
  });

  it('hiding inside the search radius is slower than leaving it', () => {
    const inside = new WantedSystem();
    const outside = new WantedSystem();
    inside.force(1, 0, 0);
    outside.force(1, 0, 0);
    run(inside, 6, 5, 5);
    run(outside, 6, 500, 0);
    expect(outside.cooldown).toBeGreaterThan(inside.cooldown);
  });
});
