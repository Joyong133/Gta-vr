import type * as THREE from 'three';
import { CanvasPanel, UI_COLORS, roundRect } from '../ui/CanvasPanel';

export interface DashboardData {
  speedKmh: number;
  gear: 'D' | 'R' | 'N';
  wanted: number;
  searching: boolean;
  objective: string;
  distance: number | null;
  prompt: string | null;
  money: number;
}

/**
 * In-car instrument screen (world space, no HUD): speed, gear, wanted level,
 * current objective with distance, and context prompts (recover / exit).
 */
export class Dashboard {
  readonly panel: CanvasPanel;
  private data: DashboardData = { speedKmh: 0, gear: 'N', wanted: 0, searching: false, objective: '', distance: null, prompt: null, money: 0 };
  private timer = 0;
  private blink = false;

  constructor(anchor: THREE.Object3D) {
    this.panel = new CanvasPanel(640, 320, 0.38, { transparent: true });
    anchor.add(this.panel.mesh);
    this.panel.draw = (ctx) => this.draw(ctx);
  }

  update(dt: number, d: DashboardData): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    this.blink = !this.blink;
    this.data = d;
    this.panel.markDirty();
    this.panel.refresh();
  }

  private draw(ctx: CanvasRenderingContext2D): void {
    const p = this.panel;
    const d = this.data;
    roundRect(ctx, 4, 4, 632, 312, 26);
    ctx.fillStyle = 'rgba(6, 8, 18, 0.92)';
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.border;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Speed
    p.text(String(Math.round(Math.abs(d.speedKmh))), 150, 150, 120, '#ffffff', 'center', 800);
    p.text('km/h', 150, 195, 30, UI_COLORS.dim, 'center');
    p.text(d.gear, 290, 150, 70, d.gear === 'R' ? UI_COLORS.warn : UI_COLORS.border, 'center', 800);
    // Speed bar
    const frac = Math.min(1, Math.abs(d.speedKmh) / 120);
    ctx.fillStyle = '#1b2140';
    ctx.fillRect(40, 220, 300, 14);
    ctx.fillStyle = frac > 0.8 ? UI_COLORS.bad : UI_COLORS.border;
    ctx.fillRect(40, 220, 300 * frac, 14);
    // Wanted stars
    let stars = '';
    for (let i = 0; i < 3; i++) stars += i < d.wanted ? '★' : '☆';
    const showStars = !(d.searching && d.wanted > 0 && !this.blink);
    p.text(showStars ? stars : '', 600, 70, 52, d.wanted > 0 ? UI_COLORS.warn : '#3a4166', 'right', 700);
    if (d.wanted > 0) p.text(d.searching ? '수색 중 - 시야 밖으로' : '추격 중!', 600, 105, 24, d.searching ? UI_COLORS.dim : UI_COLORS.bad, 'right');
    p.text(`$${d.money.toLocaleString()}`, 600, 150, 32, UI_COLORS.good, 'right', 700);
    // Objective
    if (d.objective) {
      const dist = d.distance !== null ? `  ${d.distance < 1000 ? Math.round(d.distance) + 'm' : (d.distance / 1000).toFixed(1) + 'km'}` : '';
      ctx.save();
      ctx.beginPath();
      ctx.rect(360, 170, 260, 80);
      ctx.clip();
      p.wrap(d.objective + dist, 365, 200, 250, 24, UI_COLORS.text, 1.2);
      ctx.restore();
    }
    if (d.prompt) {
      roundRect(ctx, 30, 255, 580, 50, 14);
      ctx.fillStyle = this.blink ? '#4a1224' : '#2a0c18';
      ctx.fill();
      p.text(d.prompt, 320, 290, 26, '#ffffff', 'center', 700);
    }
  }
}
