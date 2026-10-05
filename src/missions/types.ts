/** Data schema for missions (see missions.json). */

export type ObjectiveType =
  | 'reach_zone'
  | 'pickup_item'
  | 'deliver_item'
  | 'enter_vehicle'
  | 'checkpoints'
  | 'clear_wanted'
  | 'wanted_at_least'
  | 'talk_to';

export type ActionDef =
  | { action: 'spawn_item'; item: string }
  | { action: 'despawn_item'; item: string }
  | { action: 'set_wanted'; level: number; zone?: string }
  | { action: 'toast'; text: string; kind?: 'info' | 'good' | 'warn' | 'bad' }
  | { action: 'show_checkpoints'; ids: string[] }
  | { action: 'hide_checkpoints' };

export interface ObjectiveDef {
  id: string;
  type: ObjectiveType;
  /** Player-facing objective text (Korean). */
  text: string;
  zone?: string;
  /** pickup_item / deliver_item target; on reach_zone the player must also carry it. */
  item?: string;
  socket?: string;
  vehicle?: string;
  checkpoints?: string[];
  level?: number;
  npc?: string;
  /** Saving mid-mission resumes from the latest objective flagged as a checkpoint. */
  checkpoint?: boolean;
  onStart?: ActionDef[];
  onComplete?: ActionDef[];
}

export type FailConditionDef =
  | { type: 'time_limit'; seconds: number; objective?: string }
  | { type: 'busted' }
  | { type: 'wanted_at_least'; level: number };

export type SuccessConditionDef = { type: 'all_objectives' };

export interface MissionDef {
  id: string;
  title: string;
  description: string;
  giver: string;
  start: {
    requiresCompleted?: string[];
    maxWanted?: number;
  };
  objectives: ObjectiveDef[];
  success: SuccessConditionDef;
  fail: FailConditionDef[];
  rewards: { money: number };
  next: string | null;
}

export interface MissionFile {
  version: number;
  missions: MissionDef[];
}
