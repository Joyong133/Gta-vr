import * as THREE from 'three';
import { tuning } from '../config/tuning';
import type { StaticWorld } from '../world/StaticWorld';
import type { Draggable } from './Door';
import { Grabbable } from './Grabbable';
import type { Interactable } from './Interactable';
import type { InteractorHand } from './InteractorHand';
import { PanelInteractable } from './PanelInteractable';
import type { Socket } from './Socket';

const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _head = new THREE.Vector3();

function isDraggable(i: Interactable): i is Interactable & Draggable {
  return typeof (i as unknown as Draggable).beginDrag === 'function';
}

export interface InteractionEvents {
  onGrab?: (item: Grabbable, hand: InteractorHand) => void;
  onRelease?: (item: Grabbable, hand: InteractorHand) => void;
  onSocket?: (item: Grabbable, socket: Socket) => void;
  onHover?: (i: Interactable, hand: InteractorHand) => void;
  onItemLost?: (item: Grabbable) => void;
}

/**
 * Drives every hand each frame:
 *   held item -> follow hand / release (throw) / use (trigger)
 *   otherwise -> pick hover target (near first, then far ray with line-of-sight),
 *                grip = grab or drag (doors, wheel), trigger = select (buttons, UI, NPCs)
 * Uses the explicit registry; never traverses the scene graph.
 */
export class InteractionManager {
  readonly interactables: Interactable[] = [];
  readonly sockets: Socket[] = [];
  readonly hands: InteractorHand[] = [];
  private readonly dragging = new Map<InteractorHand, Interactable & Draggable>();
  /** Desktop: max distance for picking things with the mouse ray. */
  desktopReach = 3.2;
  /**
   * While this returns a socket (the player car's passenger seat while driving), every release or
   * throw goes into that socket or is dropped outside the cabin, never left inside the chassis.
   */
  carSocket: (() => Socket | null) | null = null;

  constructor(
    private readonly world: StaticWorld,
    private readonly head: () => THREE.Vector3,
    private readonly events: InteractionEvents = {},
  ) {}

  register<T extends Interactable>(i: T): T {
    if (!this.interactables.includes(i)) this.interactables.push(i);
    return i;
  }

  unregister(i: Interactable): void {
    const idx = this.interactables.indexOf(i);
    if (idx >= 0) this.interactables.splice(idx, 1);
    for (const h of this.hands) if (h.hover === i) this.setHover(h, null, false);
  }

  addSocket(s: Socket): Socket {
    this.sockets.push(s);
    return s;
  }

  setHands(hands: InteractorHand[]): void {
    for (const h of this.hands) {
      if (hands.includes(h)) continue; // still connected: keep its item, drag and hover
      this.releaseHand(h, true);
      this.setHover(h, null, false);
      h.updateVisual(null, null);
    }
    this.hands.length = 0;
    this.hands.push(...hands);
  }

  update(dt: number): void {
    for (const hand of this.hands) {
      hand.grip.updateWorldMatrix(true, false);
      hand.ray.updateWorldMatrix(true, false);
      hand.recordPose(dt);
      if (!hand.active) {
        if (hand.held) this.releaseHand(hand, false);
        this.setHover(hand, null, false);
        hand.updateVisual(null, null);
        continue;
      }
      this.updateHand(hand, dt);
    }
    for (const s of this.sockets) s.follow();
    this.updateSocketHints();
    this.recoverLostItems();
  }

  private updateHand(hand: InteractorHand, dt: number): void {
    // --- Dragging (doors, steering wheel)
    const drag = this.dragging.get(hand);
    if (drag) {
      if (!hand.gripHeld) {
        drag.endDrag(hand);
        this.dragging.delete(hand);
      } else {
        drag.updateDrag(hand, dt);
        hand.updateVisual(null, null);
        return;
      }
    }

    // --- Holding
    const held = hand.held;
    if (held) {
      if (held.primary === hand) held.updateHeld(dt);
      if (hand.gripUp || !hand.gripHeld) {
        this.releaseHand(hand, false);
      } else {
        if (hand.triggerDown) held.onUse?.(hand, true);
        if (hand.triggerUp) held.onUse?.(hand, false);
      }
      hand.updateVisual(null, null);
      return;
    }

    // --- Hover selection
    let best: Interactable | null = null;
    let bestScore = Infinity;
    let far = false;
    const isDesktop = hand.id === 'desktop';
    if (!isDesktop) {
      hand.touchPoint(_p);
      const r = tuning.player.nearGrabRadius;
      for (const i of this.interactables) {
        if (!i.enabled || !i.nearSelectable) continue;
        if (i instanceof Grabbable && i.isHeld) {
          if (i.twoHand === 'none' || i.secondary) continue;
          // Second hand reaches for the foregrip (or the object centre).
          if (i.secondaryAnchor) _a.copy(i.secondaryAnchor).applyMatrix4(i.object.matrixWorld);
          else i.getAnchor(_a);
        } else i.getAnchor(_a);
        const d = _a.distanceTo(_p) - i.nearRadius;
        if (d < r && d < bestScore) {
          bestScore = d;
          best = i;
        }
      }
    }
    let rayLen: number | null = null;
    if (!best) {
      hand.rayOrigin(_o);
      hand.rayDirection(_d);
      let bestT = Infinity;
      for (const i of this.interactables) {
        if (!i.enabled || !i.farSelectable) continue;
        if (i instanceof Grabbable && i.isHeld) continue;
        const max = isDesktop && !(i instanceof PanelInteractable) ? this.desktopReach : i.maxFarDistance;
        const t = i.rayIntersect(_o, _d, max);
        if (t !== null && t < bestT) {
          bestT = t;
          best = i;
        }
      }
      if (best) {
        // Line of sight: do not select through walls.
        const blocked = this.world.raycast(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, Math.max(0, bestT - 0.05));
        if (blocked) best = null;
        else {
          far = true;
          rayLen = bestT;
          hand.hoverPoint.copy(_d).multiplyScalar(bestT).add(_o);
          if (best instanceof PanelInteractable) best.updatePointer(hand, _o, _d);
        }
      }
    }
    this.setHover(hand, best, far);

    if (best) best.hoverUpdate(hand, dt);

    // --- Actions
    if (best && hand.gripDown) {
      if (best instanceof Grabbable) {
        best.grab(hand, far);
        this.events.onGrab?.(best, hand);
        this.setHover(hand, null, false);
      } else if (isDraggable(best) && !far) {
        best.beginDrag(hand);
        this.dragging.set(hand, best);
      }
    } else if (best && hand.triggerDown) {
      best.select(hand, far ? hand.hoverPoint : null);
    }

    const showRay = far && best !== null;
    hand.updateVisual(showRay ? rayLen : null, showRay && best instanceof PanelInteractable ? hand.hoverPoint : null);
  }

  private setHover(hand: InteractorHand, target: Interactable | null, far: boolean): void {
    if (hand.hover === target) {
      hand.hoverFar = far;
      return;
    }
    if (hand.hover) hand.hover.setHover(hand, false);
    hand.hover = target;
    hand.hoverFar = far;
    if (target) {
      target.setHover(hand, true);
      hand.pulse(0.1, 10);
      this.events.onHover?.(target, hand);
    }
  }

  /** Releases whatever the hand holds; checks sockets and keeps items on the player's side of walls. */
  releaseHand(hand: InteractorHand, silent: boolean): void {
    const drag = this.dragging.get(hand);
    if (drag) {
      drag.endDrag(hand);
      this.dragging.delete(hand);
    }
    const item = hand.held;
    if (!item) return;
    hand.getVelocity(_v);
    hand.getAngularVelocity(_w);
    if (silent) {
      _v.set(0, 0, 0);
      _w.set(0, 0, 0);
    }
    const free = item.release(hand, _v, _w);
    if (!free) return;
    // Socket snap?
    for (const s of this.sockets) {
      if (!s.canAccept(item)) continue;
      s.worldPosition(_a);
      if (_a.distanceTo(item.object.position) <= s.radius) {
        s.insert(item);
        hand.pulse(0.5, 60);
        this.events.onSocket?.(item, s);
        this.events.onRelease?.(item, hand);
        return;
      }
    }
    if (this.releaseInCar(item, hand)) return;
    this.keepOutOfWalls(item);
    this.events.onRelease?.(item, hand);
  }

  /** Desktop throw: release with an explicit velocity. */
  throwFromHand(hand: InteractorHand, velocity: THREE.Vector3): void {
    const item = hand.held;
    if (!item) return;
    const free = item.release(hand, velocity, _w.set(0, 0, 0));
    if (free) {
      if (this.releaseInCar(item, hand)) return;
      this.keepOutOfWalls(item);
      this.events.onRelease?.(item, hand);
    }
  }

  /**
   * Seated in the car: a freed item would otherwise become a dynamic prop inside the chassis
   * colliders and get squeezed out onto the road. Seat it, or drop it above the roof.
   * Returns true when handled (onRelease already emitted).
   */
  private releaseInCar(item: Grabbable, hand: InteractorHand): boolean {
    const car = this.carSocket?.();
    if (!car) return false;
    if (car.canAccept(item)) {
      car.insert(item);
      hand.pulse(0.5, 60);
      this.events.onSocket?.(item, car);
    } else {
      // Not seat-able (non-mission item or seat taken): never leave it inside the cabin box.
      car.worldPosition(_a);
      item.object.position.set(_a.x, _a.y + 1.4, _a.z);
      item.setKinematic(false);
      item.body?.velocity.set(0, 0, 0);
      item.body?.angularVelocity.set(0, 0, 0);
    }
    this.events.onRelease?.(item, hand);
    return true;
  }

  /** If an item was released inside a wall, move it back toward the player's head. */
  private keepOutOfWalls(item: Grabbable): void {
    const pos = item.object.position;
    const head = _head.copy(this.head());
    _d.subVectors(pos, head);
    const len = _d.length();
    if (len < 1e-3) return;
    _d.divideScalar(len);
    const hit = this.world.raycast(head.x, head.y, head.z, _d.x, _d.y, _d.z, len + 0.15);
    if (hit) {
      const safe = Math.max(0, hit.t - 0.25);
      pos.copy(head).addScaledVector(_d, safe);
      item.setKinematic(false);
      item.body?.velocity.set(0, 0, 0);
    }
  }

  private updateSocketHints(): void {
    for (const s of this.sockets) {
      let hint = 0;
      if (!s.item && s.enabled) {
        for (const h of this.hands) {
          const item = h.held;
          if (!item || !s.accepts(item)) continue;
          s.worldPosition(_a);
          const d = _a.distanceTo(item.object.position);
          hint = Math.max(hint, d < 3 ? 1 - d / 3 : 0);
        }
      }
      s.setHint(hint);
    }
  }

  private recoverLostItems(): void {
    for (const i of this.interactables) {
      if (!(i instanceof Grabbable) || i.isHeld || i.socket) continue;
      const p = i.object.position;
      if (p.y < -3 || Math.abs(p.x) > 149 || Math.abs(p.z) > 149) {
        i.resetToHome();
        this.events.onItemLost?.(i);
      }
    }
  }

  /** Drops everything (used when entering vehicles, respawning, mission restarts). */
  releaseAll(): void {
    for (const h of this.hands) this.releaseHand(h, true);
  }

  isHolding(item: Grabbable): boolean {
    return item.isHeld;
  }
}
