import * as THREE from 'three';
import type { Grabbable } from '../interaction/Grabbable';
import type { InteractionManager } from '../interaction/InteractionManager';
import { Socket } from '../interaction/Socket';
import type { Markers } from '../ui/Markers';
import type { PlayerVehicle } from '../vehicles/PlayerVehicle';
import { CHECKPOINTS, ITEM_SPAWNS, MISSION_GIVER, SOCKETS, zoneById, isInZone } from '../world/CityLayout';
import type { PropFactory } from '../world/PropFactory';
import type { MissionContext, MissionSystem } from './MissionSystem';

const _v = new THREE.Vector3();

export interface MissionWorldDeps {
  /** Player position (feet / car centre). */
  playerPos(out: THREE.Vector3): THREE.Vector3;
  isDriving(): boolean;
  wantedLevel(): number;
}

/**
 * Connects mission data to the 3D world: spawns mission items, owns delivery
 * sockets, answers objective predicates, detects checkpoint gates and decides
 * where the objective marker / GPS should point.
 */
export class MissionWorld implements MissionContext {
  readonly items = new Map<string, Grabbable>();
  readonly sockets = new Map<string, Socket>();
  private shownCheckpoints: string[] | null = null;

  constructor(
    private readonly props: PropFactory,
    private readonly interaction: InteractionManager,
    private readonly markers: Markers,
    private readonly vehicle: PlayerVehicle,
    private readonly deps: MissionWorldDeps,
    dropboxAnchor: THREE.Object3D,
  ) {
    const s = new Socket('kai_dropbox', dropboxAnchor, SOCKETS.kai_dropbox.r, (item) => item.itemId === 'package_m1');
    s.lockOnInsert = true;
    this.sockets.set('kai_dropbox', s);
    interaction.addSocket(s);
    interaction.addSocket(vehicle.passengerSocket);
  }

  private ensureItem(id: string): Grabbable {
    let item = this.items.get(id);
    if (item) return item;
    const spawn = ITEM_SPAWNS[id];
    const pos = new THREE.Vector3(spawn?.x ?? 0, spawn?.y ?? 1, spawn?.z ?? 0);
    if (id.startsWith('datachip')) item = this.props.dataChip(id, pos);
    else item = this.props.parcel(id, pos);
    this.items.set(id, item);
    return item;
  }

  spawnItem(id: string): void {
    const item = this.ensureItem(id);
    if (item.isHeld) {
      for (const h of this.interaction.hands) if (h.held === item) this.interaction.releaseHand(h, true);
    }
    if (item.socket) item.socket.remove(item);
    const sp = ITEM_SPAWNS[id];
    _v.set(sp.x, sp.y, sp.z);
    item.enabled = true;
    item.object.visible = true;
    item.placeAt(_v, new THREE.Quaternion());
    item.setHome(_v, new THREE.Quaternion());
    this.interaction.register(item);
  }

  despawnItem(id: string): void {
    const item = this.items.get(id);
    if (!item) return;
    for (const h of this.interaction.hands) if (h.held === item) this.interaction.releaseHand(h, true);
    if (item.socket) item.socket.remove(item);
    this.interaction.unregister(item);
    item.enabled = false;
    item.object.visible = false;
    item.setKinematic(true);
    item.object.position.set(0, -50, 0);
    item.copyToBody();
  }

  /** Removes all mission items + resets sockets (mission restart / abandon / load). */
  resetAll(): void {
    for (const id of this.items.keys()) this.despawnItem(id);
    for (const s of this.sockets.values()) {
      if (s.item) {
        const it = s.item;
        s.remove(it);
        it.enabled = true;
      }
    }
    this.showCheckpoints(null);
  }

  showCheckpoints(ids: string[] | null): void {
    this.shownCheckpoints = ids;
    this.markers.showCheckpoints(ids);
  }

  // ---------------- MissionContext
  wantedLevel(): number {
    return this.deps.wantedLevel();
  }

  inZone(zoneId: string): boolean {
    const z = zoneById(zoneId);
    if (!z) return false;
    this.deps.playerPos(_v);
    return isInZone(z, _v.x, _v.z);
  }

  inVehicle(vehicleId: string): boolean {
    return vehicleId === this.vehicle.id && this.deps.isDriving();
  }

  itemCollected(itemId: string): boolean {
    const item = this.items.get(itemId);
    if (!item || !item.enabled) return false;
    return item.isHeld || item.socket === this.vehicle.passengerSocket;
  }

  itemInSocket(itemId: string, socketId: string): boolean {
    const s = this.sockets.get(socketId);
    return !!s && s.item?.itemId === itemId;
  }

  /** Detects driving through the next checkpoint gate. */
  update(missions: MissionSystem): void {
    const next = missions.nextCheckpointId;
    if (!next) {
      if (this.shownCheckpoints) this.markers.setNextCheckpoint(null, null);
      return;
    }
    const list = missions.currentObjective?.checkpoints ?? [];
    const idx = list.indexOf(next);
    this.markers.setNextCheckpoint(next, list[idx + 1] ?? null);
    const cp = CHECKPOINTS.find((c) => c.id === next);
    if (!cp) return;
    this.deps.playerPos(_v);
    if (this.deps.isDriving() && Math.hypot(_v.x - cp.x, _v.z - cp.z) < 7.5) {
      missions.handle({ type: 'checkpoint', id: next });
    }
  }

  /** Where the marker / GPS should point for the current objective. */
  targetPosition(missions: MissionSystem, out: THREE.Vector3): THREE.Vector3 | null {
    const o = missions.currentObjective;
    if (!o) return null;
    switch (o.type) {
      case 'reach_zone': {
        // Zone that needs an item the player dropped: lead back to the item first.
        if (o.item && !this.itemCollected(o.item)) {
          const it = this.items.get(o.item);
          if (it?.enabled) return out.copy(it.object.position);
        }
        const z = o.zone ? zoneById(o.zone) : undefined;
        return z ? out.set(z.x, 0, z.z) : null;
      }
      case 'pickup_item': {
        const item = o.item ? this.items.get(o.item) : undefined;
        return item ? out.copy(item.object.position) : null;
      }
      case 'deliver_item': {
        const item = o.item ? this.items.get(o.item) : undefined;
        // First make sure the player actually has the item.
        if (item && !item.isHeld && item.socket !== this.vehicle.passengerSocket) return out.copy(item.object.position);
        const s = o.socket ? SOCKETS[o.socket] : undefined;
        return s ? out.set(s.x, s.y, s.z) : null;
      }
      case 'enter_vehicle':
        return this.deps.isDriving() ? null : this.vehicle.worldPosition(out);
      case 'checkpoints': {
        const cp = CHECKPOINTS.find((c) => c.id === missions.nextCheckpointId);
        if (!cp) return null;
        if (!this.deps.isDriving()) return this.vehicle.worldPosition(out);
        return out.set(cp.x, 0, cp.z);
      }
      case 'talk_to':
        return out.set(MISSION_GIVER.x, 0, MISSION_GIVER.z);
      case 'clear_wanted':
      case 'wanted_at_least':
        return null;
    }
  }
}
