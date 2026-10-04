import { defaultSettings, sanitizeSettings, type Settings } from '../config/settings';

/**
 * Versioned save data. Stored as JSON in localStorage (one main slot + one backup).
 * Any missing / corrupted / out-of-range field is replaced with a safe default.
 */
export const SAVE_VERSION = 1;

export interface SavedActiveMission {
  id: string;
  objectiveIndex: number;
}

export interface SaveData {
  version: number;
  savedAt: number;
  player: { position: [number, number, number]; yaw: number };
  money: number;
  completedMissions: string[];
  activeMission: SavedActiveMission | null;
  settings: Settings;
}

export type LoadStatus = 'ok' | 'missing' | 'corrupt-recovered-backup' | 'corrupt-defaults' | 'repaired';

export interface LoadResult {
  data: SaveData;
  status: LoadStatus;
  /** Human-readable notes about what was repaired (shown in debug / toast). */
  notes: string[];
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory fallback (private browsing with blocked storage, unit tests). */
export class MemoryStorage implements KeyValueStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

export const DEFAULT_SPAWN: [number, number, number] = [-52, 0, -24];
export const DEFAULT_YAW = 0;
const WORLD_LIMIT = 146;

export function defaultSaveData(): SaveData {
  return {
    version: SAVE_VERSION,
    savedAt: 0,
    player: { position: [...DEFAULT_SPAWN], yaw: DEFAULT_YAW },
    money: 100,
    completedMissions: [],
    activeMission: null,
    settings: defaultSettings(),
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validates a parsed save object field by field.
 * Returns null when the structure is unusable (not an object / wrong version family).
 */
export function sanitizeSave(raw: unknown, knownMissionIds?: ReadonlySet<string>): { data: SaveData; notes: string[] } | null {
  if (!isObj(raw)) return null;
  if (!finite(raw.version) || raw.version < 1 || raw.version > SAVE_VERSION) return null;
  const notes: string[] = [];
  const d = defaultSaveData();

  // Player safe position: must be finite and inside the district bounds.
  let position: [number, number, number] = d.player.position;
  let yaw = d.player.yaw;
  const p = isObj(raw.player) ? raw.player : null;
  if (p && Array.isArray(p.position) && p.position.length === 3 && p.position.every(finite)) {
    const [x, y, z] = p.position as number[];
    if (Math.abs(x) <= WORLD_LIMIT && Math.abs(z) <= WORLD_LIMIT && y > -1 && y < 30) position = [x, Math.max(0, y), z];
    else notes.push('player position out of bounds -> default spawn');
  } else notes.push('player position invalid -> default spawn');
  if (p && finite(p.yaw)) yaw = p.yaw;

  let money = d.money;
  if (finite(raw.money) && raw.money >= 0) money = Math.min(Math.floor(raw.money), 9_999_999);
  else notes.push('money invalid -> default');

  let completed: string[] = [];
  if (Array.isArray(raw.completedMissions)) {
    completed = [...new Set(raw.completedMissions.filter((m): m is string => typeof m === 'string'))];
    if (knownMissionIds) {
      const before = completed.length;
      completed = completed.filter((m) => knownMissionIds.has(m));
      if (completed.length !== before) notes.push('unknown completed missions dropped');
    }
  } else notes.push('completed missions invalid -> empty');

  let active: SavedActiveMission | null = null;
  if (isObj(raw.activeMission)) {
    const am = raw.activeMission;
    const idOk = typeof am.id === 'string' && (!knownMissionIds || knownMissionIds.has(am.id));
    if (idOk && finite(am.objectiveIndex) && am.objectiveIndex >= 0 && !completed.includes(am.id as string)) {
      active = { id: am.id as string, objectiveIndex: Math.floor(am.objectiveIndex) };
    } else notes.push('active mission invalid -> cleared');
  }

  return {
    data: {
      version: SAVE_VERSION,
      savedAt: finite(raw.savedAt) ? raw.savedAt : 0,
      player: { position, yaw },
      money,
      completedMissions: completed,
      activeMission: active,
      settings: sanitizeSettings(raw.settings),
    },
    notes,
  };
}

export class SaveSystem {
  static readonly KEY = 'neon-district-vr.save';
  static readonly BACKUP_KEY = 'neon-district-vr.save.backup';

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly knownMissionIds?: ReadonlySet<string>,
  ) {}

  /** Creates a storage that falls back to memory when localStorage is unavailable or throws. */
  static createBrowserStorage(): KeyValueStorage {
    try {
      const ls = window.localStorage;
      const probe = '__neon_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    } catch {
      return new MemoryStorage();
    }
  }

  hasSave(): boolean {
    return this.safeGet(SaveSystem.KEY) !== null;
  }

  load(): LoadResult {
    const main = this.safeGet(SaveSystem.KEY);
    if (main === null) {
      return { data: defaultSaveData(), status: 'missing', notes: ['no save file'] };
    }
    const parsed = this.tryParse(main);
    if (parsed) {
      return { data: parsed.data, status: parsed.notes.length ? 'repaired' : 'ok', notes: parsed.notes };
    }
    const backup = this.safeGet(SaveSystem.BACKUP_KEY);
    const parsedBackup = backup !== null ? this.tryParse(backup) : null;
    if (parsedBackup) {
      return {
        data: parsedBackup.data,
        status: 'corrupt-recovered-backup',
        notes: ['main save corrupted -> restored backup', ...parsedBackup.notes],
      };
    }
    return { data: defaultSaveData(), status: 'corrupt-defaults', notes: ['save corrupted and no valid backup -> defaults'] };
  }

  save(data: SaveData): boolean {
    const payload: SaveData = { ...data, version: SAVE_VERSION, savedAt: Date.now() };
    try {
      // Keep the previous good save as a backup before overwriting.
      const prev = this.storage.getItem(SaveSystem.KEY);
      if (prev !== null && this.tryParse(prev)) this.storage.setItem(SaveSystem.BACKUP_KEY, prev);
      this.storage.setItem(SaveSystem.KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(SaveSystem.KEY);
      this.storage.removeItem(SaveSystem.BACKUP_KEY);
    } catch {
      /* storage unavailable: nothing to clear */
    }
  }

  /** Debug helper used by the QA checklist: writes garbage into the main slot. */
  corruptForTesting(): void {
    try {
      this.storage.setItem(SaveSystem.KEY, '{"version":1,"money":"lots",,,broken');
    } catch {
      /* ignore */
    }
  }

  private tryParse(text: string): { data: SaveData; notes: string[] } | null {
    try {
      return sanitizeSave(JSON.parse(text), this.knownMissionIds);
    } catch {
      return null;
    }
  }

  private safeGet(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }
}
