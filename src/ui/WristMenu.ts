import * as THREE from 'three';
import { SNAP_ANGLES, type Settings } from '../config/settings';
import { CanvasPanel, UI_COLORS, type PanelButton } from './CanvasPanel';
import type { MapState, Minimap } from './Minimap';

export type MenuPage = 'status' | 'map' | 'comfort' | 'audio' | 'system';

export interface MenuModel {
  money(): number;
  wanted(): { level: number; searching: boolean; cooldown: number };
  mission(): { title: string; objective: string; timeLeft: number | null; progress: string | null } | null;
  settings(): Settings;
  changeSettings(mutate: (s: Settings) => void): void;
  mapState(): MapState;
  debugEnabled(): boolean;
  saveInfo(): string;
  inVehicle(): boolean;
  run(action: MenuAction): void;
}

export type MenuAction =
  | 'restart_mission'
  | 'abandon_mission'
  | 'call_car'
  | 'save'
  | 'load'
  | 'reset_save'
  | 'corrupt_save'
  | 'toggle_debug'
  | 'calibrate_height'
  | 'recenter'
  | 'respawn'
  | 'recover_car';

const TABS: [MenuPage, string][] = [
  ['status', '상태'],
  ['map', '지도'],
  ['comfort', '편안함'],
  ['audio', '소리·화면'],
  ['system', '시스템'],
];

function cycle<T>(list: readonly T[], v: T): T {
  const i = list.indexOf(v);
  return list[(i + 1) % list.length];
}

/**
 * Wrist menu (VR: attached to the off hand; desktop: DOM overlay of the same canvas).
 * Pages: status, map, comfort options, audio/graphics, system (save/load/debug).
 */
export class WristMenu {
  readonly panel: CanvasPanel;
  page: MenuPage = 'status';
  open = false;
  private refreshTimer = 0;
  private time = 0;
  onClick?: () => void;

  constructor(
    private readonly model: MenuModel,
    private readonly minimap: Minimap,
  ) {
    this.panel = new CanvasPanel(1024, 860, 0.34, { transparent: true });
    this.panel.mesh.visible = false;
    this.panel.draw = (ctx) => this.draw(ctx);
    this.panel.onButton = (id) => this.onButton(id);
  }

  /** Mounts the panel above the given hand grip (VR). */
  attachTo(grip: THREE.Object3D | null): void {
    const m = this.panel.mesh;
    m.removeFromParent();
    if (!grip) return;
    grip.add(m);
    m.position.set(0, 0.17, -0.02);
    m.rotation.set(-0.35, 0, 0);
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.panel.mesh.visible = open && this.panel.mesh.parent !== null;
    this.panel.markDirty();
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  update(dt: number): void {
    this.time += dt;
    if (!this.open) return;
    this.refreshTimer -= dt;
    if (this.refreshTimer <= 0) {
      this.refreshTimer = this.page === 'map' ? 0.15 : 0.25;
      this.panel.markDirty();
    }
    this.panel.refresh();
  }

  private onButton(id: string): void {
    this.onClick?.();
    if (id.startsWith('tab:')) {
      this.page = id.slice(4) as MenuPage;
      return;
    }
    const m = this.model;
    const set = (fn: (s: Settings) => void): void => m.changeSettings(fn);
    switch (id) {
      case 'loco':
        set((s) => (s.comfort.locomotion = cycle(['both', 'smooth', 'teleport'] as const, s.comfort.locomotion)));
        break;
      case 'turn':
        set((s) => (s.comfort.turnMode = cycle(['snap', 'smooth'] as const, s.comfort.turnMode)));
        break;
      case 'snap':
        set((s) => (s.comfort.snapAngle = cycle(SNAP_ANGLES, s.comfort.snapAngle as (typeof SNAP_ANGLES)[number])));
        break;
      case 'turnspeed':
        set((s) => (s.comfort.smoothTurnSpeed = cycle([60, 90, 120, 150, 180], s.comfort.smoothTurnSpeed)));
        break;
      case 'speed':
        set((s) => (s.comfort.moveSpeed = cycle([1.5, 2.2, 3.0, 4.0], s.comfort.moveSpeed)));
        break;
      case 'vignette':
        set((s) => (s.comfort.vignette = cycle(['off', 'low', 'high'] as const, s.comfort.vignette)));
        break;
      case 'hand':
        set((s) => (s.comfort.dominantHand = s.comfort.dominantHand === 'right' ? 'left' : 'right'));
        break;
      case 'movedir':
        set((s) => (s.comfort.moveDirection = s.comfort.moveDirection === 'head' ? 'hand' : 'head'));
        break;
      case 'stance':
        set((s) => (s.comfort.stance = s.comfort.stance === 'standing' ? 'seated' : 'standing'));
        break;
      case 'horizon':
        set((s) => (s.comfort.horizonLockInVehicle = !s.comfort.horizonLockInVehicle));
        break;
      case 'wheel':
        set((s) => (s.comfort.wheelGrabSteering = !s.comfort.wheelGrabSteering));
        break;
      case 'quality':
        set((s) => (s.graphics.quality = cycle(['low', 'medium', 'high'] as const, s.graphics.quality)));
        break;
      default:
        if (id.startsWith('vol:')) {
          const [, key, dir] = id.split(':');
          set((s) => {
            const k = key as keyof Settings['audio'];
            s.audio[k] = Math.round(Math.min(1, Math.max(0, s.audio[k] + (dir === '+' ? 0.1 : -0.1))) * 10) / 10;
          });
        } else if (id.startsWith('act:')) {
          m.run(id.slice(4) as MenuAction);
        }
    }
  }

  private draw(ctx: CanvasRenderingContext2D): void {
    const p = this.panel;
    p.drawBackground(30);
    const buttons: PanelButton[] = [];
    TABS.forEach(([id, label], i) => {
      buttons.push({ id: `tab:${id}`, x: 24 + i * 197, y: 22, w: 186, h: 72, label, active: this.page === id });
    });
    const y0 = 120;
    switch (this.page) {
      case 'status':
        this.drawStatus(ctx, y0, buttons);
        break;
      case 'map':
        this.minimap.draw(ctx, 24, y0, this.model.mapState(), this.time);
        ['● 경찰 (가까운 순찰)', '■ 내 차', '◎ 현재 목표', '! MIKA 미션', '붉은 원 = 경찰 수색 범위', '흰 화살표 = 나'].forEach((l, i) =>
          p.text(l, 650, y0 + 40 + i * 44, 28, UI_COLORS.dim),
        );
        break;
      case 'comfort':
        this.drawComfort(buttons, y0);
        break;
      case 'audio':
        this.drawAudio(buttons, y0);
        break;
      case 'system':
        this.drawSystem(buttons, y0);
        break;
    }
    p.buttons = buttons;
    p.drawButtons();
  }

  private drawStatus(_ctx: CanvasRenderingContext2D, y0: number, buttons: PanelButton[]): void {
    const p = this.panel;
    const m = this.model;
    const w = m.wanted();
    p.text(`$${m.money().toLocaleString()}`, 40, y0 + 70, 64, UI_COLORS.good, 'left', 800);
    const stars = '★'.repeat(w.level) + '☆'.repeat(3 - w.level);
    p.text(stars, 984, y0 + 66, 64, w.level ? UI_COLORS.warn : '#3a4166', 'right', 700);
    if (w.level > 0) {
      p.text(w.searching ? `수색 중 · 따돌리는 중 ${Math.round(w.cooldown * 100)}%` : '추격 중 — 시야를 끊어라!', 984, y0 + 112, 28, w.searching ? UI_COLORS.dim : UI_COLORS.bad, 'right');
    }
    const mission = m.mission();
    let y = y0 + 170;
    if (mission) {
      p.text(mission.title, 40, y, 40, UI_COLORS.border, 'left', 700);
      y += 50;
      y = p.wrap(mission.objective, 40, y, 940, 34, UI_COLORS.text);
      const extra = [mission.progress, mission.timeLeft !== null ? `남은 시간 ${Math.ceil(mission.timeLeft)}초` : null].filter(Boolean).join(' · ');
      if (extra) p.text(extra, 40, y + 6, 30, UI_COLORS.warn);
      buttons.push({ id: 'act:restart_mission', x: 40, y: 600, w: 300, h: 88, label: '미션 재시작' });
      buttons.push({ id: 'act:abandon_mission', x: 362, y: 600, w: 300, h: 88, label: '미션 포기', style: 'danger' });
    } else {
      p.text('진행 중인 미션 없음', 40, y, 38, UI_COLORS.dim);
      p.wrap('디스패치 광장의 MIKA(주황색 재킷, 머리 위 !)에게 가서 A/E로 말을 걸어 미션을 받으세요.', 40, y + 50, 940, 30, UI_COLORS.dim);
    }
    buttons.push({ id: 'act:call_car', x: 684, y: 600, w: 300, h: 88, label: '내 차 호출' });
    buttons.push({ id: 'act:save', x: 40, y: 710, w: 300, h: 88, label: '저장', style: 'primary' });
    buttons.push({ id: m.inVehicle() ? 'act:recover_car' : 'act:respawn', x: 362, y: 710, w: 300, h: 88, label: m.inVehicle() ? '차량 복구' : '안전 지점으로' });
    buttons.push({ id: 'act:recenter', x: 684, y: 710, w: 300, h: 88, label: '시점 재정렬' });
  }

  private drawComfort(buttons: PanelButton[], y0: number): void {
    const c = this.model.settings().comfort;
    const loco = { both: '스틱+텔레포트', smooth: '스틱 이동', teleport: '텔레포트만' }[c.locomotion];
    const vig = { off: '끄기', low: '약하게', high: '강하게' }[c.vignette];
    const rows: [string, string][] = [
      ['loco', `이동: ${loco}`],
      ['turn', `회전: ${c.turnMode === 'snap' ? '스냅' : '부드럽게'}`],
      ['snap', `스냅 각도: ${c.snapAngle}°`],
      ['turnspeed', `회전 속도: ${c.smoothTurnSpeed}°/s`],
      ['speed', `이동 속도: ${c.moveSpeed.toFixed(1)} m/s`],
      ['vignette', `비네트: ${vig}`],
      ['hand', `주 사용 손: ${c.dominantHand === 'right' ? '오른손' : '왼손'}`],
      ['movedir', `이동 기준: ${c.moveDirection === 'head' ? '머리' : '손'}`],
      ['stance', `자세: ${c.stance === 'standing' ? '서서' : '앉아서'}`],
      ['act:calibrate_height', `키 보정 (${c.heightOffset >= 0 ? '+' : ''}${c.heightOffset.toFixed(2)}m)`],
      ['horizon', `차량 수평 고정: ${c.horizonLockInVehicle ? '켜짐' : '꺼짐'}`],
      ['wheel', `핸들 잡기 조향: ${c.wheelGrabSteering ? '켜짐' : '꺼짐'}`],
    ];
    rows.forEach(([id, label], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      buttons.push({ id, x: 30 + col * 490, y: y0 + row * 112, w: 474, h: 96, label, style: id.startsWith('act:') ? 'primary' : 'toggle' });
    });
  }

  private drawAudio(buttons: PanelButton[], y0: number): void {
    const p = this.panel;
    const s = this.model.settings();
    const rows: [keyof Settings['audio'], string][] = [
      ['master', '전체 음량'],
      ['sfx', '효과음'],
      ['ambience', '환경음'],
      ['vehicle', '차량'],
    ];
    rows.forEach(([key, label], i) => {
      const y = y0 + i * 110;
      p.text(`${label}: ${Math.round(s.audio[key] * 100)}%`, 40, y + 62, 38, UI_COLORS.text);
      buttons.push({ id: `vol:${key}:-`, x: 640, y, w: 150, h: 92, label: '−' });
      buttons.push({ id: `vol:${key}:+`, x: 820, y, w: 150, h: 92, label: '+' });
    });
    const q = { low: '낮음 (그림자 없음)', medium: '중간', high: '높음' }[s.graphics.quality];
    buttons.push({ id: 'quality', x: 30, y: y0 + 460, w: 940, h: 96, label: `그래픽 품질: ${q}`, style: 'toggle' });
  }

  private drawSystem(buttons: PanelButton[], y0: number): void {
    const p = this.panel;
    const items: [string, string, PanelButton['style']][] = [
      ['act:save', '지금 저장', 'primary'],
      ['act:load', '마지막 저장 불러오기', 'normal'],
      ['act:toggle_debug', `디버그 표시: ${this.model.debugEnabled() ? '켜짐' : '꺼짐'}`, 'toggle'],
      ['act:respawn', '안전 지점으로 이동', 'normal'],
      ['act:corrupt_save', '저장 손상 테스트(QA)', 'danger'],
      ['act:reset_save', '저장 데이터 초기화', 'danger'],
    ];
    items.forEach(([id, label, style], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      buttons.push({ id, x: 30 + col * 490, y: y0 + row * 112, w: 474, h: 96, label, style });
    });
    p.wrap(this.model.saveInfo(), 40, y0 + 400, 940, 28, UI_COLORS.dim);
  }
}
