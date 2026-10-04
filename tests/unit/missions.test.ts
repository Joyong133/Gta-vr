import { describe, expect, it } from 'vitest';
import missionData from '../../src/missions/missions.json';
import { MissionSystem, parseMissionFile, type MissionContext, type MissionHooks } from '../../src/missions/MissionSystem';
import type { ActionDef } from '../../src/missions/types';

function setup() {
  const world = {
    wanted: 0,
    zone: '' as string,
    vehicle: false,
    held: new Set<string>(),
    sockets: new Map<string, string>(),
  };
  const log = { money: 0, actions: [] as ActionDef[], completed: [] as string[], failed: [] as string[] };
  const ctx: MissionContext = {
    wantedLevel: () => world.wanted,
    inZone: (z) => world.zone === z,
    inVehicle: () => world.vehicle,
    itemCollected: (i) => world.held.has(i),
    itemInSocket: (i, s) => world.sockets.get(i) === s,
  };
  const hooks: MissionHooks = {
    runAction: (a) => {
      log.actions.push(a);
      if (a.action === 'set_wanted') world.wanted = a.level;
    },
    giveMoney: (n) => {
      log.money += n;
    },
    onCompleted: (m) => log.completed.push(m.id),
    onFailed: (m, r) => log.failed.push(`${m.id}:${r}`),
  };
  const ms = new MissionSystem(parseMissionFile(missionData), hooks);
  return { ms, ctx, world, log };
}

describe('mission data', () => {
  it('parses and links all missions', () => {
    const defs = parseMissionFile(missionData);
    expect(defs.map((d) => d.id)).toEqual(['m1_delivery', 'm2_neon_run', 'm3_hot_drive']);
    expect(defs[0].next).toBe('m2_neon_run');
  });

  it('rejects broken data', () => {
    expect(() => parseMissionFile({ missions: [{ id: 'a', objectives: [], start: {} }] })).toThrow();
    expect(() => parseMissionFile({ version: 1 })).toThrow();
  });
});

describe('MissionSystem', () => {
  it('enforces start conditions', () => {
    const { ms } = setup();
    expect(ms.canStart('m2_neon_run', 0).ok).toBe(false);
    expect(ms.canStart('m1_delivery', 2).ok).toBe(false);
    expect(ms.canStart('m1_delivery', 0).ok).toBe(true);
    expect(ms.nextAvailable('mika')?.id).toBe('m1_delivery');
  });

  it('runs the delivery mission end to end and rewards once', () => {
    const { ms, ctx, world, log } = setup();
    expect(ms.start('m1_delivery', 0)).toBe(true);
    expect(ms.currentObjective?.id).toBe('go_store');
    world.zone = 'store_front';
    ms.update(0.016, ctx);
    expect(ms.currentObjective?.id).toBe('take_pkg');
    expect(log.actions).toContainEqual({ action: 'spawn_item', item: 'package_m1' });
    world.held.add('package_m1');
    ms.update(0.016, ctx);
    expect(ms.currentObjective?.id).toBe('drive');
    world.vehicle = true;
    ms.update(0.016, ctx);
    expect(ms.currentObjective?.id).toBe('deliver');
    world.sockets.set('package_m1', 'kai_dropbox');
    ms.update(0.016, ctx);
    ms.update(0.016, ctx);
    ms.update(0.016, ctx);
    expect(ms.active).toBeNull();
    expect(log.money).toBe(250);
    expect(log.completed).toEqual(['m1_delivery']);
    // Cannot be started (and rewarded) again.
    expect(ms.start('m1_delivery', 0)).toBe(false);
    expect(log.money).toBe(250);
    expect(ms.nextAvailable('mika')?.id).toBe('m2_neon_run');
  });

  it('ignores duplicate and out-of-order checkpoint events', () => {
    const { ms, ctx, world, log } = setup();
    ms.restoreCompleted(['m1_delivery']);
    ms.start('m2_neon_run', 0);
    world.vehicle = true;
    ms.update(0.016, ctx);
    expect(ms.currentObjective?.id).toBe('race');
    expect(ms.handle({ type: 'checkpoint', id: 'cp2' })).toBe(false); // out of order
    expect(ms.handle({ type: 'checkpoint', id: 'cp1' })).toBe(true);
    expect(ms.handle({ type: 'checkpoint', id: 'cp1' })).toBe(false); // duplicate
    expect(ms.checkpointProgress).toEqual({ index: 1, total: 9 });
    for (const id of ['cp2', 'cp3', 'cp4', 'cp5', 'cp6', 'cp7', 'cp8', 'cp9']) ms.handle({ type: 'checkpoint', id });
    for (const id of ['cp9', 'cp9']) ms.handle({ type: 'checkpoint', id });
    expect(ms.active).toBeNull();
    expect(log.money).toBe(400);
    expect(log.actions.some((a) => a.action === 'hide_checkpoints')).toBe(true);
  });

  it('fails on the race time limit and can restart', () => {
    const { ms, ctx, world, log } = setup();
    ms.restoreCompleted(['m1_delivery']);
    ms.start('m2_neon_run', 0);
    world.vehicle = true;
    ms.update(0.016, ctx);
    for (let i = 0; i < 151; i++) ms.update(1, ctx);
    expect(log.failed[0]).toContain('m2_neon_run');
    expect(ms.active).toBeNull();
    expect(ms.restart()).toBe(true);
    expect(ms.activeDef?.id).toBe('m2_neon_run');
    expect(ms.currentObjective?.id).toBe('get_in');
  });

  it('escape mission needs the wanted level cleared before the safehouse counts', () => {
    const { ms, ctx, world, log } = setup();
    ms.restoreCompleted(['m1_delivery', 'm2_neon_run']);
    ms.start('m3_hot_drive', 0);
    world.zone = 'impound';
    ms.update(0.016, ctx);
    world.held.add('datachip_m3');
    ms.update(0.016, ctx);
    expect(world.wanted).toBe(2); // alarm action raised the level
    expect(ms.currentObjective?.id).toBe('lose_cops');
    world.zone = 'safehouse';
    ms.update(0.016, ctx);
    expect(ms.currentObjective?.id).toBe('lose_cops'); // still wanted
    world.wanted = 0;
    ms.update(0.016, ctx);
    ms.update(0.016, ctx);
    expect(ms.active).toBeNull();
    expect(log.money).toBe(800);
  });

  it('fails when busted', () => {
    const { ms, log } = setup();
    ms.start('m1_delivery', 0);
    ms.handle({ type: 'busted' });
    expect(ms.active).toBeNull();
    expect(log.failed[0]).toContain('체포');
  });

  it('resumes from the latest checkpoint objective', () => {
    const { ms, log } = setup();
    // Saved while driving with the parcel (index 3) -> resume at take_pkg (index 1), item respawned.
    expect(ms.resume('m1_delivery', 3)).toBe(true);
    expect(ms.currentObjective?.id).toBe('take_pkg');
    expect(log.actions).toContainEqual({ action: 'spawn_item', item: 'package_m1' });
  });
});
