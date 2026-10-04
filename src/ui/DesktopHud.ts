/** Minimal DOM HUD for the desktop test path (VR uses world-space UI instead). */
export interface HudState {
  money: number;
  wanted: number;
  searching: boolean;
  missionTitle: string | null;
  objective: string | null;
  timeLeft: number | null;
  prompt: string | null;
  inVehicle: boolean;
  speedKmh: number;
}

export class DesktopHud {
  private readonly root = document.getElementById('hud');
  private readonly status = document.getElementById('status');
  private readonly promptEl = document.getElementById('prompt');
  private readonly crosshair = document.getElementById('crosshair');
  private last = '';
  private lastPrompt = '';

  setVisible(v: boolean): void {
    this.root?.classList.toggle('hidden', !v);
  }

  update(s: HudState): void {
    if (!this.status) return;
    const stars = '★'.repeat(s.wanted) + '☆'.repeat(3 - s.wanted);
    const timer = s.timeLeft !== null ? ` · ⏱ ${Math.ceil(s.timeLeft)}s` : '';
    const html =
      `<div class="money">$${s.money.toLocaleString()}</div>` +
      `<div class="stars${s.searching && s.wanted > 0 ? ' flash' : ''}">${stars}</div>` +
      (s.wanted > 0 ? `<div style="color:${s.searching ? '#8ea3c0' : '#ff3d6e'}">${s.searching ? '수색 중 — 시야 밖으로 이동' : '추격 중!'}</div>` : '') +
      (s.missionTitle ? `<div class="obj"><b>${escapeHtml(s.missionTitle)}</b>${timer}<br>${escapeHtml(s.objective ?? '')}</div>` : '<div class="obj" style="color:#8ea3c0">광장의 MIKA에게서 미션 받기</div>') +
      (s.inVehicle ? `<div>${Math.round(Math.abs(s.speedKmh))} km/h</div>` : '');
    if (html !== this.last) {
      this.status.innerHTML = html;
      this.last = html;
    }
    const p = s.prompt ?? '';
    if (p !== this.lastPrompt && this.promptEl) {
      this.promptEl.textContent = p;
      this.promptEl.style.display = p ? 'block' : 'none';
      this.lastPrompt = p;
    }
    if (this.crosshair) this.crosshair.style.display = s.inVehicle ? 'none' : 'block';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
