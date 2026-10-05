import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import missionData from '../../src/missions/missions.json';
import { MissionSystem, parseMissionFile, type MissionContext, type MissionHooks } from '../../src/missions/MissionSystem';
import { MissionWorld } from '../../src/missions/MissionWorld';
import type { ActionDef } from '../../src/missions/types';

function setup() {
  const world = { wanted: 0, zone: '', vehicle: false, held: new Set<string>() };
  const log = { money: 0, actions: [] as ActionDef[], failed: [] as string[] };
  const ctx: MissionContext = {
    wantedLevel: () => world.wanted,
    inZone: (z) => world.zone === z,
    inVehicle: () => world.vehicle,
    itemCollected: (i) => world.held.has(i),
    itemInSocket: () => false,
  };
  const hooks: MissionHooks = {
    runAction: (a) => {
      log.actions.push(a);
      if (a.action === 'set_wanted') world.wanted = a.level;
    },
    giveMoney: (n) => {
      log.money += n;
    },
    onFailed: (m, r) => log.failed.push(`${m.id}:${r}`),
  };
  return { ms: new MissionSystem(parseMissionFile(missionData), hooks), ctx, world, log };
}

describe('Neon Run resume (C19)', () => {
  it('a save taken mid-race resumes at get_in, and the race clock starts only back in the car', () => {
    const { ms, ctx, world, log } = setup();
    ms.restoreCompleted(['m1_delivery']);
    expect(ms.resume('m2_neon_run', 1)).toBe(true); // snapshot taken during 'race'
    expect(ms.currentObjective?.id).toBe('get_in');
    expect(ms.timeLeft()).toBeNull();
    expect(log.actions.some((a) => a.action === 'show_checkpoints')).toBe(false);
    world.vehicle = true;
    ms.update(0.016, ctx);
    expect(ms.currentObjective?.id).toBe('race');
    expect(ms.timeLeft()).toBeCloseTo(150, 0);
  });
});

describe('Hot Drive needs the chip at the safehouse (C23)', () => {
  it('dropping the chip blocks completion until it is picked up again', () => {
    const { ms, ctx, world, log } = setup();
    ms.restoreCompleted(['m1_delivery', 'm2_neon_run']);
    ms.start('m3_hot_drive', 0);
    world.zone = 'impound';
    ms.update(0.016, ctx);
    world.held.add('datachip_m3');
    ms.update(0.016, ctx);
    expect(ms.currentObjective?.id).toBe('lose_cops');
    world.held.delete('datachip_m3'); // dropped at the impound
    world.wanted = 0;
    ms.update(0.016, ctx);
    expect(ms.currentObjective?.id).toBe('reach_safehouse');
    world.zone = 'safehouse';
    for (let i = 0; i < 5; i++) ms.update(0.016, ctx);
    expect(ms.currentObjective?.id).toBe('reach_safehouse');
    expect(log.money).toBe(0);
    world.held.add('datachip_m3');
    ms.update(0.016, ctx);
    expect(ms.active).toBeNull();
    expect(log.money).toBe(800);
  });

  it('the objective beacon leads back to a dropped chip, then to the garage', () => {
    const passengerSocket = { id: 'car_passenger_seat' };
    const vehicle = { id: 'player_car', passengerSocket, worldPosition: (o: THREE.Vector3) => o.set(0, 0, 0) };
    const interaction = { addSocket: () => undefined, hands: [] };
    const markers = { showCheckpoints: () => undefined, setNextCheckpoint: () => undefined };
    const deps = { playerPos: (o: THREE.Vector3) => o.set(-23, 0, 23), isDriving: () => false, wantedLevel: () => 0 };
    const mw = new MissionWorld({} as never, interaction as never, markers as never, vehicle as never, deps, new THREE.Object3D());
    const chip = { enabled: true, isHeld: false, socket: null as unknown, object: new THREE.Object3D() };
    chip.object.position.set(57, 0.98, 70);
    mw.items.set('datachip_m3', chip as never);

    const ms = new MissionSystem(parseMissionFile(missionData), { runAction: () => undefined, giveMoney: () => undefined });
    ms.restoreCompleted(['m1_delivery', 'm2_neon_run']);
    expect(ms.start('m3_hot_drive', 0, 3)).toBe(true);
    expect(ms.currentObjective?.id).toBe('reach_safehouse');

    const out = new THREE.Vector3();
    expect(mw.targetPosition(ms, out)?.toArray()).toEqual([57, 0.98, 70]);
    ms.update(0.016, mw); // standing in the garage without the chip
    expect(ms.currentObjective?.id).toBe('reach_safehouse');

    chip.socket = passengerSocket; // riding on the passenger seat counts as carried
    const t = mw.targetPosition(ms, out)!;
    expect([t.x, t.z]).toEqual([-23, 23]);
    ms.update(0.016, mw);
    expect(ms.active).toBeNull();
  });
});

describe('restart after failure (C20)', () => {
  it('a real failure stays restartable; abandoning does not', () => {
    const { ms } = setup();
    ms.start('m1_delivery', 0);
    ms.abandon();
    expect(ms.active).toBeNull();
    expect(ms.lastFailure).toBeNull();
    expect(ms.restart()).toBe(false);

    ms.start('m1_delivery', 0);
    ms.handle({ type: 'busted' });
    expect(ms.lastFailure?.id).toBe('m1_delivery');
    expect(ms.restart()).toBe(true);
    expect(ms.activeDef?.id).toBe('m1_delivery');
    expect(ms.currentObjective?.id).toBe('go_store');
    expect(ms.lastFailure).toBeNull();
  });
});
