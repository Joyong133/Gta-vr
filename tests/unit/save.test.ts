import { describe, expect, it } from 'vitest';
import { defaultSettings, sanitizeSettings } from '../../src/config/settings';
import { DEFAULT_SPAWN, MemoryStorage, SaveSystem, defaultSaveData, sanitizeSave } from '../../src/save/SaveSystem';

const known = new Set(['m1_delivery', 'm2_neon_run', 'm3_hot_drive']);

describe('SaveSystem', () => {
  it('returns defaults when there is no save', () => {
    const s = new SaveSystem(new MemoryStorage(), known);
    const r = s.load();
    expect(r.status).toBe('missing');
    expect(r.data.money).toBe(defaultSaveData().money);
  });

  it('round-trips progress and settings', () => {
    const s = new SaveSystem(new MemoryStorage(), known);
    const d = defaultSaveData();
    d.money = 1234;
    d.completedMissions = ['m1_delivery'];
    d.activeMission = { id: 'm2_neon_run', objectiveIndex: 1 };
    d.player.position = [10, 0, -20];
    d.settings.comfort.turnMode = 'smooth';
    d.settings.audio.master = 0.3;
    expect(s.save(d)).toBe(true);
    const r = s.load();
    expect(r.status).toBe('ok');
    expect(r.data.money).toBe(1234);
    expect(r.data.completedMissions).toEqual(['m1_delivery']);
    expect(r.data.activeMission).toEqual({ id: 'm2_neon_run', objectiveIndex: 1 });
    expect(r.data.player.position).toEqual([10, 0, -20]);
    expect(r.data.settings.comfort.turnMode).toBe('smooth');
    expect(r.data.settings.audio.master).toBe(0.3);
  });

  it('recovers the backup when the main slot is corrupted', () => {
    const storage = new MemoryStorage();
    const s = new SaveSystem(storage, known);
    const d = defaultSaveData();
    d.money = 500;
    s.save(d);
    d.money = 900;
    s.save(d); // first save becomes the backup
    s.corruptForTesting();
    const r = s.load();
    expect(r.status).toBe('corrupt-recovered-backup');
    expect(r.data.money).toBe(500);
  });

  it('falls back to defaults when everything is corrupted', () => {
    const storage = new MemoryStorage();
    storage.setItem(SaveSystem.KEY, 'not json at all');
    storage.setItem(SaveSystem.BACKUP_KEY, '{"version": 99}');
    const r = new SaveSystem(storage, known).load();
    expect(r.status).toBe('corrupt-defaults');
    expect(r.data.player.position).toEqual(DEFAULT_SPAWN);
  });

  it('repairs individual invalid fields', () => {
    const res = sanitizeSave(
      {
        version: 1,
        player: { position: [9999, 0, 0], yaw: 'x' },
        money: -50,
        completedMissions: ['m1_delivery', 'bogus', 42, 'm1_delivery'],
        activeMission: { id: 'm1_delivery', objectiveIndex: 2 },
        settings: { comfort: { snapAngle: 33, moveSpeed: 99, vignette: 'ultra' }, audio: { master: 7 } },
      },
      known,
    );
    expect(res).not.toBeNull();
    const d = res!.data;
    expect(d.player.position).toEqual(DEFAULT_SPAWN);
    expect(d.money).toBe(100);
    expect(d.completedMissions).toEqual(['m1_delivery']);
    expect(d.activeMission).toBeNull(); // completed missions cannot be active
    expect(d.settings.comfort.snapAngle).toBe(defaultSettings().comfort.snapAngle);
    expect(d.settings.comfort.moveSpeed).toBe(5);
    expect(d.settings.comfort.vignette).toBe('low');
    expect(d.settings.audio.master).toBe(1);
    expect(res!.notes.length).toBeGreaterThan(0);
  });

  it('survives storage that throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const s = new SaveSystem(throwing, known);
    expect(s.load().status).toBe('missing');
    expect(s.save(defaultSaveData())).toBe(false);
  });

  it('sanitizeSettings fills everything from garbage', () => {
    expect(sanitizeSettings(null)).toEqual(defaultSettings());
    expect(sanitizeSettings('nope').comfort.dominantHand).toBe('right');
  });
});
