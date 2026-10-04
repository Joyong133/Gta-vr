import * as THREE from 'three';
import type { ToastKind } from '../core/events';
import { CanvasPanel, UI_COLORS, roundRect } from './CanvasPanel';

interface Toast {
  text: string;
  kind: ToastKind;
  time: number;
}

const KIND_COLOR: Record<ToastKind, string> = {
  info: UI_COLORS.border,
  good: UI_COLORS.good,
  warn: UI_COLORS.warn,
  bad: UI_COLORS.bad,
};

const _head = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _target = new THREE.Vector3();

/**
 * Short notifications. VR: a small panel that lazily follows the head below
 * the line of sight (never locked to the face). Desktop: DOM toasts.
 */
export class Notifier {
  private readonly toasts: Toast[] = [];
  readonly panel: CanvasPanel;
  private readonly dom: HTMLElement | null;
  private initialised = false;
  xr = false;

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    this.panel = new CanvasPanel(768, 220, 0.62, { depthTest: false });
    this.panel.mesh.renderOrder = 900;
    this.panel.mesh.visible = false;
    scene.add(this.panel.mesh);
    this.panel.draw = (ctx) => this.draw(ctx);
    this.dom = document.getElementById('toasts');
  }

  push(text: string, kind: ToastKind = 'info', duration = 3.2): void {
    // Collapse exact duplicates that arrive back to back.
    if (this.toasts.length && this.toasts[this.toasts.length - 1].text === text) {
      this.toasts[this.toasts.length - 1].time = duration;
      return;
    }
    this.toasts.push({ text, kind, time: duration });
    if (this.toasts.length > 3) this.toasts.shift();
    this.panel.markDirty();
    this.renderDom();
  }

  private renderDom(): void {
    if (!this.dom) return;
    this.dom.innerHTML = '';
    for (const t of this.toasts) {
      const el = document.createElement('div');
      el.className = `toast ${t.kind}`;
      el.textContent = t.text;
      this.dom.appendChild(el);
    }
  }

  update(dt: number): void {
    let changed = false;
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      this.toasts[i].time -= dt;
      if (this.toasts[i].time <= 0) {
        this.toasts.splice(i, 1);
        changed = true;
      }
    }
    if (changed) {
      this.panel.markDirty();
      this.renderDom();
    }
    const show = this.xr && this.toasts.length > 0;
    this.panel.mesh.visible = show;
    if (!show) {
      this.initialised = false;
      return;
    }
    this.panel.refresh();
    // Lazy follow: target 1.1 m ahead, 0.3 m below eye level.
    this.camera.getWorldPosition(_head);
    this.camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _target.copy(_head).addScaledVector(_fwd, 1.1);
    _target.y = _head.y - 0.3;
    const m = this.panel.mesh;
    if (!this.initialised || m.position.distanceTo(_target) > 1.2) {
      m.position.copy(_target);
      this.initialised = true;
    } else {
      m.position.lerp(_target, 1 - Math.exp(-3 * dt));
    }
    m.lookAt(_head);
  }

  private draw(ctx: CanvasRenderingContext2D): void {
    const p = this.panel;
    let y = 10;
    for (const t of this.toasts.slice(-3)) {
      roundRect(ctx, 10, y, 748, 62, 18);
      ctx.fillStyle = 'rgba(8, 10, 22, 0.88)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = KIND_COLOR[t.kind];
      ctx.stroke();
      p.text(t.text, 384, y + 42, 30, '#ffffff', 'center', 600);
      y += 70;
    }
  }
}
