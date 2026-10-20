/**
 * 안내 표시.
 * - 왼손 패널: 지역·모드·장소·고도 + 조작법 (VR에서 왼손을 들어 보면 보인다)
 * - 토스트: 장소 이동/모드 전환 때 눈앞에 잠깐 뜨는 글자
 * - 데스크톱: 같은 내용을 화면 구석 DOM에 표시
 */
import * as THREE from 'three';

class CanvasPanel {
  readonly mesh: THREE.Mesh;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private last = '';

  constructor(
    readonly w: number,
    readonly h: number,
    widthM: number,
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas 없음');
    this.ctx = ctx;
    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, fog: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, (widthM * h) / w), mat);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
  }

  draw(lines: { text: string; size: number; color?: string }[]): void {
    const key = lines.map((l) => l.text).join('\n');
    if (key === this.last) return;
    this.last = key;
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(8, 14, 28, 0.82)';
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 28);
    ctx.fill();
    let y = 24;
    for (const l of lines) {
      ctx.font = `${l.size}px "Noto Sans KR", "Apple SD Gothic Neo", sans-serif`;
      ctx.fillStyle = l.color ?? '#eaf3ff';
      ctx.textBaseline = 'top';
      ctx.fillText(l.text, 32, y, w - 64);
      y += l.size * 1.35;
    }
    this.tex.needsUpdate = true;
  }
}

export interface HudState {
  region: string;
  mode: string;
  place: string;
  altitude: number;
  fps: number;
}

const HELP = [
  '왼스틱 이동 · 왼그립 달리기/가속',
  '오른스틱 ←→ 회전 · ↑ 텔레포트',
  '비행: 오른스틱 ↕ 상승/하강',
  'A 걷기/비행 · B 거인 모드',
  'X / Y 이전 / 다음 장소',
];

export class Hud {
  readonly wrist = new CanvasPanel(1024, 560, 0.2);
  private readonly toastPanel = new CanvasPanel(1024, 160, 0.5);
  private toastTimer = 0;
  private dom: HTMLElement | null = document.getElementById('hud');
  private domToast: HTMLElement | null = document.getElementById('toast');

  constructor(camera: THREE.Camera) {
    this.toastPanel.mesh.position.set(0, -0.12, -0.9);
    this.toastPanel.mesh.visible = false;
    camera.add(this.toastPanel.mesh);
  }

  /** 왼손 컨트롤러(그립)에 붙인다: 손등 위로 살짝 띄워 사용자 쪽으로 기울인다. */
  attachToHand(grip: THREE.Object3D): void {
    this.wrist.mesh.position.set(0, 0.07, 0.02);
    this.wrist.mesh.rotation.set(-0.9, 0, 0);
    grip.add(this.wrist.mesh);
  }

  toast(text: string): void {
    this.toastTimer = 2.5;
    this.toastPanel.draw([{ text, size: 72, color: '#ffffff' }]);
    if (this.domToast) {
      this.domToast.textContent = text;
      this.domToast.classList.add('show');
    }
  }

  update(dt: number, s: HudState, xr: boolean): void {
    this.toastTimer -= dt;
    this.toastPanel.mesh.visible = xr && this.toastTimer > 0;
    if (this.toastTimer <= 0) this.domToast?.classList.remove('show');
    const alt = s.altitude >= 1000 ? `${(s.altitude / 1000).toFixed(2)}km` : `${Math.round(s.altitude)}m`;
    const status = `${s.mode} · 지면 위 ${alt}`;
    if (xr) {
      this.wrist.draw([
        { text: `부산 · ${s.region}`, size: 58, color: '#7fe9ff' },
        { text: s.place, size: 48 },
        { text: status, size: 42, color: '#c8d6ea' },
        ...HELP.map((t) => ({ text: t, size: 34, color: '#93a7c4' })),
      ]);
    } else if (this.dom) {
      const html = `<b>부산 · ${s.region}</b><br>${s.place}<br>${status}<br><small>${s.fps} fps</small>`;
      if (this.dom.innerHTML !== html) this.dom.innerHTML = html;
    }
  }
}
