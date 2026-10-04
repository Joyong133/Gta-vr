import * as THREE from 'three';
import type { InteractorHand } from './InteractorHand';

const _c = new THREE.Vector3();
const _oc = new THREE.Vector3();

export type InteractableKind = 'grabbable' | 'door' | 'button' | 'panel' | 'npc' | 'generic';

/**
 * Base class for everything a hand can hover, select (trigger / click) or grab (grip).
 * Hover highlight is a subtle emissive tint on the registered materials.
 */
export abstract class Interactable {
  enabled = true;
  /** Extra reach for near (direct) interaction, metres. */
  nearRadius = 0.1;
  /** Can be targeted with the far ray. */
  farSelectable = true;
  /** Bounding sphere radius used by the far ray. */
  farRadius = 0.25;
  maxFarDistance = 6;
  /** Near interaction allowed (direct touch / grab). */
  nearSelectable = true;
  grabbable = false;
  /** Short verb shown in prompts, e.g. "잡기", "열기", "누르기". */
  verb = '사용';
  private readonly highlightMats: { mat: THREE.Material & { emissive?: THREE.Color }; base: THREE.Color }[] = [];
  private hoverCount = 0;
  readonly highlightColor = new THREE.Color(0x2a6f80);

  constructor(
    readonly id: string,
    readonly kind: InteractableKind,
    readonly object: THREE.Object3D,
  ) {}

  /** World point used for near-distance and far-ray tests. */
  getAnchor(out: THREE.Vector3): THREE.Vector3 {
    return this.object.getWorldPosition(out);
  }

  /** Ray test; default is a sphere around the anchor. Returns distance or null. */
  rayIntersect(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number | null {
    this.getAnchor(_c);
    _oc.subVectors(_c, origin);
    const t = _oc.dot(dir);
    if (t < 0 || t > maxDist) return null;
    const d2 = _oc.lengthSq() - t * t;
    const r = this.farRadius;
    if (d2 > r * r) return null;
    return t - Math.sqrt(r * r - d2);
  }

  /** Registers meshes whose materials get the hover tint (materials are cloned once). */
  addHighlightMeshes(...meshes: THREE.Mesh[]): void {
    for (const m of meshes) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const cloned = mats.map((mat) => {
        const c = mat.clone() as THREE.Material & { emissive?: THREE.Color };
        if (c.emissive) this.highlightMats.push({ mat: c, base: c.emissive.clone() });
        return c;
      });
      m.material = Array.isArray(m.material) ? cloned : cloned[0];
    }
  }

  setHover(_hand: InteractorHand, hovering: boolean): void {
    this.hoverCount = Math.max(0, this.hoverCount + (hovering ? 1 : -1));
    const on = this.hoverCount > 0;
    for (const h of this.highlightMats) {
      if (!h.mat.emissive) continue;
      if (on) h.mat.emissive.copy(h.base).add(this.highlightColor);
      else h.mat.emissive.copy(h.base);
    }
    this.onHoverChanged(on);
  }

  get hovered(): boolean {
    return this.hoverCount > 0;
  }

  protected onHoverChanged(_on: boolean): void {}

  /** Trigger / click while hovering (not holding). */
  select(_hand: InteractorHand, _hitPoint: THREE.Vector3 | null): void {}

  /** Called every frame while a hand is hovering (e.g. poke buttons). */
  hoverUpdate(_hand: InteractorHand, _dt: number): void {}
}
