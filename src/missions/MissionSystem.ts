import type { ActionDef, FailConditionDef, MissionDef, MissionFile, ObjectiveDef } from './types';

/** World queries the mission runner needs (implemented by MissionWorld / tests). */
export interface MissionContext {
  wantedLevel(): number;
  inZone(zoneId: string): boolean;
  inVehicle(vehicleId: string): boolean;
  /** Item is in the player's hand or riding in the player's car. */
  itemCollected(itemId: string): boolean;
  itemInSocket(itemId: string, socketId: string): boolean;
}

/** Side effects requested by missions (spawn items, set wanted, money...). */
export interface MissionHooks {
  runAction(action: ActionDef, mission: MissionDef): void;
  giveMoney(amount: number, mission: MissionDef): void;
  onStarted?(mission: MissionDef): void;
  onObjective?(mission: MissionDef, index: number, objective: ObjectiveDef): void;
  onCompleted?(mission: MissionDef, reward: number): void;
  onFailed?(mission: MissionDef, reason: string): void;
  onCheckpoint?(mission: MissionDef, id: string, index: number, total: number): void;
}

export type MissionEvent =
  | { type: 'checkpoint'; id: string }
  | { type: 'talk'; npc: string }
  | { type: 'item_socketed'; item: string; socket: string }
  | { type: 'busted' };

interface ActiveMission {
  def: MissionDef;
  index: number;
  /** Seconds since the mission started. */
  elapsed: number;
  /** Seconds since the current objective started. */
  objectiveElapsed: number;
  /** Progress inside a 'checkpoints' objective. */
  cpIndex: number;
  /** Per-objective start times (for time limits bound to an objective). */
  objectiveStart: Map<string, number>;
  /** Event keys already consumed (duplicate events are ignored). */
  consumed: Set<string>;
}

export function parseMissionFile(data: unknown): MissionDef[] {
  const file = data as MissionFile;
  if (!file || !Array.isArray(file.missions)) throw new Error('invalid mission file');
  const ids = new Set<string>();
  for (const m of file.missions) {
    if (!m.id || ids.has(m.id)) throw new Error(`duplicate/missing mission id: ${m.id}`);
    ids.add(m.id);
    if (!Array.isArray(m.objectives) || m.objectives.length === 0) throw new Error(`mission ${m.id} has no objectives`);
    const objIds = new Set<string>();
    for (const o of m.objectives) {
      if (objIds.has(o.id)) throw new Error(`duplicate objective ${o.id} in ${m.id}`);
      objIds.add(o.id);
    }
  }
  for (const m of file.missions) {
    if (m.next && !ids.has(m.next)) throw new Error(`mission ${m.id} links to unknown next ${m.next}`);
    for (const r of m.start.requiresCompleted ?? []) if (!ids.has(r)) throw new Error(`mission ${m.id} requires unknown ${r}`);
  }
  return file.missions;
}

/**
 * Runs data-driven missions. Objectives are evaluated from world predicates
 * every frame (naturally idempotent) plus a few ordered events (checkpoints,
 * talk). Rewards are granted exactly once per mission id.
 */
export class MissionSystem {
  readonly defs = new Map<string, MissionDef>();
  readonly order: string[] = [];
  readonly completed = new Set<string>();
  active: ActiveMission | null = null;
  lastFailure: { id: string; reason: string } | null = null;
  private completing = false;

  constructor(
    missions: MissionDef[],
    private readonly hooks: MissionHooks,
  ) {
    for (const m of missions) {
      this.defs.set(m.id, m);
      this.order.push(m.id);
    }
  }

  get activeDef(): MissionDef | null {
    return this.active?.def ?? null;
  }

  get currentObjective(): ObjectiveDef | null {
    const a = this.active;
    return a ? (a.def.objectives[a.index] ?? null) : null;
  }

  get checkpointProgress(): { index: number; total: number } | null {
    const o = this.currentObjective;
    if (!o || o.type !== 'checkpoints' || !this.active) return null;
    return { index: this.active.cpIndex, total: o.checkpoints?.length ?? 0 };
  }

  /** Next expected checkpoint id (driving mission). */
  get nextCheckpointId(): string | null {
    const o = this.currentObjective;
    if (!o || o.type !== 'checkpoints' || !this.active) return null;
    return o.checkpoints?.[this.active.cpIndex] ?? null;
  }

  /** Seconds left on a running time limit, if any. */
  timeLeft(): number | null {
    const a = this.active;
    if (!a) return null;
    for (const f of a.def.fail) {
      if (f.type !== 'time_limit') continue;
      const start = f.objective ? a.objectiveStart.get(f.objective) : 0;
      if (start === undefined) continue;
      return Math.max(0, f.seconds - (a.elapsed - start));
    }
    return null;
  }

  canStart(id: string, wantedLevel: number): { ok: boolean; reason?: string } {
    const m = this.defs.get(id);
    if (!m) return { ok: false, reason: '알 수 없는 미션' };
    if (this.completed.has(id)) return { ok: false, reason: '이미 완료한 미션' };
    if (this.active) return { ok: false, reason: '진행 중인 미션이 있음' };
    for (const r of m.start.requiresCompleted ?? []) if (!this.completed.has(r)) return { ok: false, reason: '이전 미션을 먼저 완료' };
    if (m.start.maxWanted !== undefined && wantedLevel > m.start.maxWanted) return { ok: false, reason: '수배 중에는 받을 수 없음' };
    return { ok: true };
  }

  /**
   * First uncompleted mission (in data order) of a giver whose prerequisites are done.
   * The UI calls canStart() to decide whether "accept" is enabled (wanted / active checks).
   */
  nextAvailable(giver: string): MissionDef | null {
    for (const id of this.order) {
      const m = this.defs.get(id)!;
      if (m.giver !== giver || this.completed.has(id)) continue;
      const deps = m.start.requiresCompleted ?? [];
      if (deps.every((d) => this.completed.has(d))) return m;
    }
    return null;
  }

  start(id: string, wantedLevel: number, resumeIndex = 0): boolean {
    if (!this.canStart(id, wantedLevel).ok) return false;
    const def = this.defs.get(id)!;
    this.active = {
      def,
      index: -1,
      elapsed: 0,
      objectiveElapsed: 0,
      cpIndex: 0,
      objectiveStart: new Map(),
      consumed: new Set(),
    };
    this.lastFailure = null;
    this.hooks.onStarted?.(def);
    this.enterObjective(Math.max(0, Math.min(resumeIndex, def.objectives.length - 1)));
    return true;
  }

  /** Resume from a save: restarts at the latest checkpoint objective <= savedIndex. */
  resume(id: string, savedIndex: number): boolean {
    const def = this.defs.get(id);
    if (!def || this.completed.has(id)) return false;
    let idx = 0;
    for (let i = 0; i <= Math.min(savedIndex, def.objectives.length - 1); i++) if (def.objectives[i].checkpoint) idx = i;
    // Resuming ignores the wanted gate: the save never stores a wanted level.
    return this.start(id, 0, idx);
  }

  private enterObjective(index: number): void {
    const a = this.active!;
    a.index = index;
    a.objectiveElapsed = 0;
    a.cpIndex = 0;
    const o = a.def.objectives[index];
    a.objectiveStart.set(o.id, a.elapsed);
    for (const act of o.onStart ?? []) this.hooks.runAction(act, a.def);
    this.hooks.onObjective?.(a.def, index, o);
  }

  private completeObjective(): void {
    const a = this.active;
    if (!a) return;
    const o = a.def.objectives[a.index];
    for (const act of o.onComplete ?? []) this.hooks.runAction(act, a.def);
    if (this.active !== a) return; // an action may have ended the mission
    if (a.index + 1 >= a.def.objectives.length) this.completeMission();
    else this.enterObjective(a.index + 1);
  }

  private completeMission(): void {
    const a = this.active;
    if (!a || this.completing) return;
    this.completing = true;
    const def = a.def;
    this.active = null;
    // Reward exactly once per mission id, even if events repeat.
    if (!this.completed.has(def.id)) {
      this.completed.add(def.id);
      this.hooks.giveMoney(def.rewards.money, def);
      this.hooks.onCompleted?.(def, def.rewards.money);
    }
    this.completing = false;
  }

  fail(reason: string): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this.lastFailure = { id: a.def.id, reason };
    this.hooks.onFailed?.(a.def, reason);
  }

  abandon(): void {
    this.fail('포기함');
  }

  /** Restart the active (or last failed) mission from its first objective. */
  restart(): boolean {
    const id = this.active?.def.id ?? this.lastFailure?.id;
    if (!id) return false;
    this.active = null;
    // The caller clears the wanted level before restarting.
    return this.start(id, 0);
  }

  handle(ev: MissionEvent): boolean {
    const a = this.active;
    if (!a) return false;
    if (ev.type === 'busted') {
      if (a.def.fail.some((f) => f.type === 'busted')) this.fail('경찰에 체포됨');
      return true;
    }
    const o = a.def.objectives[a.index];
    if (ev.type === 'checkpoint' && o.type === 'checkpoints') {
      const list = o.checkpoints ?? [];
      const key = `${o.id}:${ev.id}`;
      if (a.consumed.has(key)) return false; // already passed: duplicate trigger
      if (list[a.cpIndex] !== ev.id) return false; // out of order: ignored
      a.consumed.add(key);
      a.cpIndex++;
      this.hooks.onCheckpoint?.(a.def, ev.id, a.cpIndex, list.length);
      if (a.cpIndex >= list.length) this.completeObjective();
      return true;
    }
    if (ev.type === 'talk' && o.type === 'talk_to' && o.npc === ev.npc) {
      this.completeObjective();
      return true;
    }
    return false;
  }

  update(dt: number, ctx: MissionContext): void {
    const a = this.active;
    if (!a) return;
    a.elapsed += dt;
    a.objectiveElapsed += dt;
    for (const f of a.def.fail) {
      if (this.checkFail(f, a, ctx)) return;
    }
    // Evaluate at most one objective per frame (keeps ordering + actions sane).
    const o = a.def.objectives[a.index];
    if (o && this.isObjectiveMet(o, ctx)) this.completeObjective();
  }

  private checkFail(f: FailConditionDef, a: ActiveMission, ctx: MissionContext): boolean {
    if (f.type === 'time_limit') {
      const start = f.objective ? a.objectiveStart.get(f.objective) : 0;
      if (start === undefined) return false;
      if (f.objective && a.def.objectives[a.index]?.id !== f.objective) return false;
      if (a.elapsed - start > f.seconds) {
        this.fail('시간 초과');
        return true;
      }
    } else if (f.type === 'wanted_at_least' && ctx.wantedLevel() >= f.level) {
      this.fail('수배 단계 초과');
      return true;
    }
    return false;
  }

  isObjectiveMet(o: ObjectiveDef, ctx: MissionContext): boolean {
    switch (o.type) {
      case 'reach_zone':
        return !!o.zone && ctx.inZone(o.zone);
      case 'pickup_item':
        return !!o.item && ctx.itemCollected(o.item);
      case 'deliver_item':
        return !!o.item && !!o.socket && ctx.itemInSocket(o.item, o.socket);
      case 'enter_vehicle':
        return ctx.inVehicle(o.vehicle ?? 'player_car');
      case 'clear_wanted':
        return ctx.wantedLevel() === 0;
      case 'wanted_at_least':
        return ctx.wantedLevel() >= (o.level ?? 1);
      case 'checkpoints':
      case 'talk_to':
        return false; // event driven
    }
  }

  /** For saving. */
  snapshot(): { id: string; objectiveIndex: number } | null {
    return this.active ? { id: this.active.def.id, objectiveIndex: this.active.index } : null;
  }

  restoreCompleted(ids: readonly string[]): void {
    this.completed.clear();
    for (const id of ids) if (this.defs.has(id)) this.completed.add(id);
  }
}
