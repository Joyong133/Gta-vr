import type * as THREE from 'three';
import { tuning } from '../config/tuning';
import type { CanvasPanel } from '../ui/CanvasPanel';
import { Interactable } from './Interactable';
import type { InteractorHand } from './InteractorHand';

/**
 * Makes a CanvasPanel usable by the interaction system: the far ray hovers
 * buttons, trigger / click presses them.
 */
export class PanelInteractable extends Interactable {
  private readonly px = { x: 0, y: 0 };
  /** Last hit in canvas pixels per hand. */
  private readonly lastHit = new Map<InteractorHand, { x: number; y: number }>();
  onClickSound?: () => void;

  constructor(
    id: string,
    readonly panel: CanvasPanel,
  ) {
    super(id, 'panel', panel.mesh);
    this.nearSelectable = false;
    this.farSelectable = true;
    this.maxFarDistance = tuning.player.uiRayMaxDistance;
    this.verb = '선택';
  }

  rayIntersect(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number | null {
    if (!this.enabled) return null;
    return this.panel.intersectRay(origin, dir, maxDist, this.px);
  }

  /** Called by the manager after a successful rayIntersect for the hovering hand. */
  updatePointer(hand: InteractorHand, origin: THREE.Vector3, dir: THREE.Vector3): void {
    const t = this.panel.intersectRay(origin, dir, this.maxFarDistance, this.px);
    if (t === null) return;
    this.lastHit.set(hand, { x: this.px.x, y: this.px.y });
    const b = this.panel.buttonAt(this.px.x, this.px.y);
    const prev = this.panel.hoverId;
    this.panel.setHover(b ? b.id : null);
    if (b && b.id !== prev) hand.pulse(0.08, 8);
  }

  protected onHoverChanged(on: boolean): void {
    if (!on) this.panel.setHover(null);
  }

  select(hand: InteractorHand): void {
    const hit = this.lastHit.get(hand);
    if (!hit) return;
    if (this.panel.click(hit.x, hit.y)) {
      hand.pulse(0.3, 25);
      this.onClickSound?.();
    }
  }
}
