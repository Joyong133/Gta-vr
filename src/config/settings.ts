/**
 * Player-facing settings (comfort, audio, input, graphics).
 * Everything here is persisted in the save file and validated on load.
 */

export type LocomotionMode = 'smooth' | 'teleport' | 'both';
export type TurnMode = 'snap' | 'smooth';
export type VignetteLevel = 'off' | 'low' | 'high';
export type Handedness = 'left' | 'right';
export type Stance = 'standing' | 'seated';
export type MoveDirection = 'head' | 'hand';
export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface ComfortSettings {
  locomotion: LocomotionMode;
  turnMode: TurnMode;
  snapAngle: number; // degrees
  smoothTurnSpeed: number; // degrees per second
  moveSpeed: number; // metres per second
  vignette: VignetteLevel;
  dominantHand: Handedness;
  stance: Stance;
  /** Extra metres added to tracked head height (seated / height calibration). */
  heightOffset: number;
  moveDirection: MoveDirection;
  /** Keep the horizon level while driving (car pitch/roll is not applied to the head). */
  horizonLockInVehicle: boolean;
  /** Optional: steer by grabbing the virtual wheel. Stick steering always works. */
  wheelGrabSteering: boolean;
}

export interface AudioSettings {
  master: number;
  sfx: number;
  ambience: number;
  vehicle: number;
}

export interface InputSettings {
  stickDeadzone: number;
  mouseSensitivity: number;
  invertMouseY: boolean;
}

export interface GraphicsSettings {
  quality: GraphicsQuality;
}

export interface Settings {
  comfort: ComfortSettings;
  audio: AudioSettings;
  input: InputSettings;
  graphics: GraphicsSettings;
}

export const SNAP_ANGLES = [30, 45, 60, 90] as const;

export function defaultSettings(): Settings {
  return {
    comfort: {
      locomotion: 'both',
      turnMode: 'snap',
      snapAngle: 45,
      smoothTurnSpeed: 90,
      moveSpeed: 2.2,
      vignette: 'low',
      dominantHand: 'right',
      stance: 'standing',
      heightOffset: 0,
      moveDirection: 'head',
      horizonLockInVehicle: true,
      wheelGrabSteering: false,
    },
    audio: { master: 0.8, sfx: 0.9, ambience: 0.6, vehicle: 0.8 },
    input: { stickDeadzone: 0.18, mouseSensitivity: 1, invertMouseY: false },
    graphics: { quality: 'medium' },
  };
}

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Accepts any (possibly corrupted) value and returns a complete, valid Settings object. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  const r = obj(raw);
  const c = obj(r.comfort);
  const a = obj(r.audio);
  const i = obj(r.input);
  const g = obj(r.graphics);
  const snap = num(c.snapAngle, d.comfort.snapAngle, 15, 90);
  return {
    comfort: {
      locomotion: oneOf(c.locomotion, ['smooth', 'teleport', 'both'] as const, d.comfort.locomotion),
      turnMode: oneOf(c.turnMode, ['snap', 'smooth'] as const, d.comfort.turnMode),
      snapAngle: (SNAP_ANGLES as readonly number[]).includes(snap) ? snap : d.comfort.snapAngle,
      smoothTurnSpeed: num(c.smoothTurnSpeed, d.comfort.smoothTurnSpeed, 30, 240),
      moveSpeed: num(c.moveSpeed, d.comfort.moveSpeed, 0.8, 5),
      vignette: oneOf(c.vignette, ['off', 'low', 'high'] as const, d.comfort.vignette),
      dominantHand: oneOf(c.dominantHand, ['left', 'right'] as const, d.comfort.dominantHand),
      stance: oneOf(c.stance, ['standing', 'seated'] as const, d.comfort.stance),
      heightOffset: num(c.heightOffset, d.comfort.heightOffset, -0.5, 1.2),
      moveDirection: oneOf(c.moveDirection, ['head', 'hand'] as const, d.comfort.moveDirection),
      horizonLockInVehicle: bool(c.horizonLockInVehicle, d.comfort.horizonLockInVehicle),
      wheelGrabSteering: bool(c.wheelGrabSteering, d.comfort.wheelGrabSteering),
    },
    audio: {
      master: num(a.master, d.audio.master, 0, 1),
      sfx: num(a.sfx, d.audio.sfx, 0, 1),
      ambience: num(a.ambience, d.audio.ambience, 0, 1),
      vehicle: num(a.vehicle, d.audio.vehicle, 0, 1),
    },
    input: {
      stickDeadzone: num(i.stickDeadzone, d.input.stickDeadzone, 0.05, 0.5),
      mouseSensitivity: num(i.mouseSensitivity, d.input.mouseSensitivity, 0.2, 3),
      invertMouseY: bool(i.invertMouseY, d.input.invertMouseY),
    },
    graphics: {
      quality: oneOf(g.quality, ['low', 'medium', 'high'] as const, d.graphics.quality),
    },
  };
}
