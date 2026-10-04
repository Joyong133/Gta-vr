import * as THREE from 'three';

export interface PanelButton {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  enabled?: boolean;
  active?: boolean;
  /** Visual style hint. */
  style?: 'primary' | 'normal' | 'danger' | 'toggle';
}

const _plane = new THREE.Plane();
const _hit = new THREE.Vector3();
const _local = new THREE.Vector3();
const _n = new THREE.Vector3();
const _inv = new THREE.Matrix4();

export const UI_FONT = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';

export const UI_COLORS = {
  bg: 'rgba(10, 12, 24, 0.86)',
  bgSolid: '#0a0c18',
  panel: 'rgba(22, 26, 48, 0.9)',
  border: '#3df5ff',
  text: '#eef6ff',
  dim: '#8ea3c0',
  accent: '#ff4fd8',
  good: '#3dffb0',
  warn: '#ffd23f',
  bad: '#ff3d6e',
  button: '#1d2342',
  buttonHover: '#2f3c75',
  buttonActive: '#0f6d7a',
};

/**
 * World-space UI panel backed by a 2D canvas (CanvasTexture).
 * Owners draw content in `draw` and declare buttons; ray hits are mapped to
 * canvas pixels so the same panel works in VR (controller ray) and on desktop.
 */
export class CanvasPanel {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  buttons: PanelButton[] = [];
  hoverId: string | null = null;
  private dirty = true;
  draw: (ctx: CanvasRenderingContext2D, panel: CanvasPanel) => void = () => undefined;
  onButton?: (id: string) => void;

  constructor(
    readonly pxWidth: number,
    readonly pxHeight: number,
    readonly worldWidth: number,
    opts: { transparent?: boolean; depthTest?: boolean } = {},
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxWidth;
    this.canvas.height = pxHeight;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const worldHeight = (worldWidth * pxHeight) / pxWidth;
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: opts.transparent ?? true,
      depthTest: opts.depthTest ?? true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldWidth, worldHeight), mat);
    this.mesh.renderOrder = 50;
  }

  get worldHeight(): number {
    return (this.worldWidth * this.pxHeight) / this.pxWidth;
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Redraws the canvas if anything changed. */
  refresh(force = false): void {
    if (!this.dirty && !force) return;
    this.dirty = false;
    this.ctx.clearRect(0, 0, this.pxWidth, this.pxHeight);
    this.draw(this.ctx, this);
    this.texture.needsUpdate = true;
  }

  /** Ray vs panel rectangle. Returns hit distance and writes canvas pixel coords. */
  intersectRay(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, outPx?: { x: number; y: number }): number | null {
    if (!this.mesh.visible) return null;
    let o: THREE.Object3D | null = this.mesh;
    while (o) {
      if (!o.visible) return null;
      o = o.parent;
    }
    this.mesh.updateWorldMatrix(true, false);
    _n.set(0, 0, 1).transformDirection(this.mesh.matrixWorld);
    _hit.setFromMatrixPosition(this.mesh.matrixWorld);
    _plane.setFromNormalAndCoplanarPoint(_n, _hit);
    const denom = _plane.normal.dot(dir);
    if (Math.abs(denom) < 1e-6) return null;
    const t = -(origin.dot(_plane.normal) + _plane.constant) / denom;
    if (t < 0 || t > maxDist) return null;
    _hit.copy(dir).multiplyScalar(t).add(origin);
    _inv.copy(this.mesh.matrixWorld).invert();
    _local.copy(_hit).applyMatrix4(_inv);
    const w = this.worldWidth;
    const h = this.worldHeight;
    if (Math.abs(_local.x) > w / 2 || Math.abs(_local.y) > h / 2) return null;
    if (outPx) {
      outPx.x = (_local.x / w + 0.5) * this.pxWidth;
      outPx.y = (0.5 - _local.y / h) * this.pxHeight;
    }
    return t;
  }

  buttonAt(px: number, py: number): PanelButton | null {
    for (const b of this.buttons) {
      if (b.enabled === false) continue;
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b;
    }
    return null;
  }

  setHover(id: string | null): void {
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.markDirty();
    }
  }

  click(px: number, py: number): boolean {
    const b = this.buttonAt(px, py);
    if (!b) return false;
    this.onButton?.(b.id);
    this.markDirty();
    return true;
  }

  // ---------- drawing helpers ----------
  drawBackground(radius = 28, fill = UI_COLORS.bg, border = UI_COLORS.border): void {
    const c = this.ctx;
    roundRect(c, 3, 3, this.pxWidth - 6, this.pxHeight - 6, radius);
    c.fillStyle = fill;
    c.fill();
    c.lineWidth = 4;
    c.strokeStyle = border;
    c.globalAlpha = 0.8;
    c.stroke();
    c.globalAlpha = 1;
  }

  drawButtons(): void {
    const c = this.ctx;
    for (const b of this.buttons) {
      const hover = this.hoverId === b.id && b.enabled !== false;
      roundRect(c, b.x, b.y, b.w, b.h, Math.min(18, b.h / 3));
      let fill = UI_COLORS.button;
      if (b.style === 'primary') fill = '#123f4a';
      if (b.style === 'danger') fill = '#4a1224';
      if (b.active) fill = UI_COLORS.buttonActive;
      if (hover) fill = UI_COLORS.buttonHover;
      c.fillStyle = fill;
      c.globalAlpha = b.enabled === false ? 0.35 : 1;
      c.fill();
      c.lineWidth = hover ? 4 : 2;
      c.strokeStyle = b.style === 'danger' ? UI_COLORS.bad : b.active || b.style === 'primary' ? UI_COLORS.border : '#3a4677';
      c.stroke();
      c.fillStyle = UI_COLORS.text;
      c.font = `600 ${Math.round(Math.min(34, b.h * 0.42))}px ${UI_FONT}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
      c.globalAlpha = 1;
    }
  }

  text(str: string, x: number, y: number, size: number, color = UI_COLORS.text, align: CanvasTextAlign = 'left', weight = 500): void {
    const c = this.ctx;
    c.fillStyle = color;
    c.font = `${weight} ${size}px ${UI_FONT}`;
    c.textAlign = align;
    c.textBaseline = 'alphabetic';
    c.fillText(str, x, y);
  }

  /** Word-wraps text into a box; returns the y after the last line. */
  wrap(str: string, x: number, y: number, maxW: number, size: number, color = UI_COLORS.dim, lineH = 1.3): number {
    const c = this.ctx;
    c.fillStyle = color;
    c.font = `400 ${size}px ${UI_FONT}`;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    let line = '';
    for (const ch of str.split('')) {
      const test = line + ch;
      if (c.measureText(test).width > maxW && line) {
        c.fillText(line, x, y);
        y += size * lineH;
        line = ch === ' ' ? '' : ch;
      } else line = test;
    }
    if (line) {
      c.fillText(line, x, y);
      y += size * lineH;
    }
    return y;
  }
}

export function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
