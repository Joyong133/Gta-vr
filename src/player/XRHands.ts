import * as THREE from 'three';
import type { InputRouter } from '../input/InputRouter';
import { InteractorHand } from '../interaction/InteractorHand';

/**
 * Binds three.js XR controller slots (target ray + grip spaces) to
 * left/right InteractorHands using the inputSource handedness reported in
 * the 'connected' event (slot order is not guaranteed by WebXR).
 */
export class XRHands {
  readonly hands = new Map<'left' | 'right', InteractorHand>();
  private readonly slots: { ray: THREE.Group; grip: THREE.Group; hand: 'left' | 'right' | null }[] = [];
  onChange?: () => void;

  constructor(
    renderer: THREE.WebGLRenderer,
    parent: THREE.Object3D,
    private readonly input: InputRouter,
    private readonly scene: THREE.Scene,
  ) {
    for (let i = 0; i < 2; i++) {
      const ray = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      parent.add(ray, grip);
      const slot = { ray, grip, hand: null as 'left' | 'right' | null };
      this.slots.push(slot);
      ray.addEventListener('connected', (e) => {
        const src = (e as unknown as { data: XRInputSource }).data;
        if (!src || (src.handedness !== 'left' && src.handedness !== 'right')) return;
        if (!src.gamepad) return; // hand tracking without a gamepad is not supported in v1
        slot.hand = src.handedness;
        this.bind(slot.hand, ray, grip);
      });
      ray.addEventListener('disconnected', () => {
        if (slot.hand) {
          const h = this.hands.get(slot.hand);
          if (h && h.grip === grip) {
            h.active = false;
            h.visual.visible = false;
          }
        }
        slot.hand = null;
        this.onChange?.();
      });
    }
  }

  private bind(hand: 'left' | 'right', ray: THREE.Group, grip: THREE.Group): void {
    const existing = this.hands.get(hand);
    if (existing && existing.grip === grip && existing.ray === ray) {
      existing.active = true;
      existing.visual.visible = true;
      this.onChange?.();
      return;
    }
    if (existing) {
      existing.visual.removeFromParent();
      existing.rayLine.removeFromParent();
    }
    const h = new InteractorHand(hand, grip, ray, this.input.controller(hand));
    h.attachCursor(this.scene);
    this.hands.set(hand, h);
    this.onChange?.();
  }

  list(): InteractorHand[] {
    return [...this.hands.values()].filter((h) => h.active);
  }

  /** Copies controller button state into the hands' interaction inputs. */
  feedInputs(): void {
    for (const h of this.hands.values()) {
      const c = h.controller;
      if (!c) continue;
      h.gripDown = c.squeeze.down;
      h.gripUp = c.squeeze.up;
      h.gripHeld = c.squeeze.pressed;
      h.gripValue = c.squeeze.value;
      h.triggerDown = c.trigger.down;
      h.triggerUp = c.trigger.up;
      h.triggerHeld = c.trigger.pressed;
      h.triggerValue = c.trigger.value;
    }
  }

  setVisible(v: boolean): void {
    for (const s of this.slots) {
      s.ray.visible = v;
      s.grip.visible = v;
    }
  }
}
