import type * as CANNON from 'cannon-es';

export type CrimeType = 'hit_pedestrian' | 'assault_civilian' | 'shots_fired' | 'hit_police_vehicle' | 'assault_police' | 'alarm';
export type Witness = 'police' | 'civilian' | 'system';
export type ToastKind = 'info' | 'good' | 'warn' | 'bad';

/** Every cross-system event in the game. */
export interface GameEvents extends Record<string, unknown> {
  crime: { type: CrimeType; x: number; z: number; witness: Witness };
  'wanted:changed': { level: number; prev: number };
  'wanted:cleared': { level: number };
  'player:busted': { fine: number };
  'item:grabbed': { itemId: string };
  'item:released': { itemId: string };
  'item:socketed': { itemId: string; socketId: string };
  'zone:enter': { zoneId: string };
  'zone:exit': { zoneId: string };
  'vehicle:enter': { vehicleId: string };
  'vehicle:exit': { vehicleId: string };
  'checkpoint:passed': { checkpointId: string };
  'npc:talk': { npcId: string };
  'money:changed': { money: number; delta: number };
  toast: { text: string; kind?: ToastKind; duration?: number };
  /** Something scary happened (crash, gunshot, speeding car) - pedestrians react. */
  danger: { x: number; z: number; radius: number; severity: number };
  'mission:started': { id: string };
  'mission:objective': { id: string; index: number; text: string };
  'mission:completed': { id: string; reward: number };
  'mission:failed': { id: string; reason: string };
}

export type BodyKind = 'player_car' | 'traffic' | 'police' | 'prop';

export interface BodyTag {
  kind: BodyKind;
  id: string;
}

/** Associates physics bodies with gameplay meaning (collision events, projectile hits). */
export const bodyTags = new WeakMap<CANNON.Body, BodyTag>();
