import * as THREE from 'three';
import { angleDelta } from '../core/math';
import { Interactable } from '../interaction/Interactable';
import type { InteractorHand } from '../interaction/InteractorHand';
import { PanelInteractable } from '../interaction/PanelInteractable';
import type { MissionDef } from '../missions/types';
import { CanvasPanel, UI_COLORS, type PanelButton } from '../ui/CanvasPanel';
import { PedModel } from './PedModel';

/** Talkable NPC body (select with trigger/click or interact with A/E nearby). */
class NpcInteractable extends Interactable {
  onTalk?: () => void;
  constructor(id: string, object: THREE.Object3D) {
    super(id, 'npc', object);
    this.nearRadius = 0.45;
    this.farRadius = 0.6;
    this.maxFarDistance = 7;
    this.verb = '대화';
  }
  getAnchor(out: THREE.Vector3): THREE.Vector3 {
    return this.object.getWorldPosition(out).setY(1.25);
  }
  select(_hand: InteractorHand): void {
    this.onTalk?.();
  }
}

export interface BoardModel {
  offer(): MissionDef | null;
  active(): MissionDef | null;
  canAccept(): { ok: boolean; reason?: string };
  accept(): void;
  restart(): void;
  abandon(): void;
  allDone(): boolean;
}

/**
 * MIKA, the dispatcher. Shows a world-space mission board with accept /
 * restart / abandon buttons when talked to.
 */
export class MissionGiver {
  readonly model: PedModel;
  readonly talk: NpcInteractable;
  readonly board: CanvasPanel;
  readonly boardInteractable: PanelInteractable;
  private readonly marker: THREE.Mesh;
  private readonly markerMat: THREE.MeshBasicMaterial;
  private time = 0;
  boardOpen = false;
  private readonly pos: THREE.Vector3;
  private yaw = 0;
  private redrawTimer = 0;

  constructor(
    scene: THREE.Scene,
    readonly id: string,
    x: number,
    z: number,
    private readonly data: BoardModel,
  ) {
    this.pos = new THREE.Vector3(x, 0, z);
    this.model = new PedModel({ shirt: 0xff7a1a, pants: 0x1d1d2b, skin: 0xf1c27d, hair: 0xff4fd8, accent: 0x3df5ff, height: 1.02 });
    this.model.root.position.copy(this.pos);
    scene.add(this.model.root);
    // Holo tablet
    const tablet = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.15, 0.01), new THREE.MeshBasicMaterial({ color: 0x3df5ff, transparent: true, opacity: 0.7, toneMapped: false }));
    tablet.position.set(0.05, -0.55, -0.12);
    tablet.rotation.x = -0.6;
    this.model.armL.add(tablet);

    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xff9a3d, toneMapped: false });
    this.marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), this.markerMat);
    this.marker.scale.set(0.6, 1.4, 0.6);
    this.marker.position.set(x, 2.35, z);
    scene.add(this.marker);

    this.talk = new NpcInteractable(id, this.model.root);
    this.talk.onTalk = () => this.openBoard();

    this.board = new CanvasPanel(960, 640, 0.95, { transparent: true });
    this.board.mesh.visible = false;
    scene.add(this.board.mesh);
    this.board.draw = (ctx) => this.drawBoard(ctx);
    this.board.onButton = (bid) => this.onButton(bid);
    this.boardInteractable = new PanelInteractable(`${id}_board`, this.board);
  }

  openBoard(): void {
    this.boardOpen = true;
    this.board.mesh.visible = true;
    this.board.markDirty();
  }

  closeBoard(): void {
    this.boardOpen = false;
    this.board.mesh.visible = false;
  }

  private onButton(id: string): void {
    switch (id) {
      case 'accept':
        this.data.accept();
        this.closeBoard();
        break;
      case 'restart':
        this.data.restart();
        this.closeBoard();
        break;
      case 'abandon':
        this.data.abandon();
        this.board.markDirty();
        break;
      case 'close':
        this.closeBoard();
        break;
    }
  }

  update(dt: number, viewer: THREE.Vector3): void {
    this.time += dt;
    const dx = viewer.x - this.pos.x;
    const dz = viewer.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    // Face the player when nearby.
    if (d < 10) {
      const target = Math.atan2(-dx, -dz);
      this.yaw += angleDelta(this.yaw, target) * Math.min(1, dt * 3);
    }
    this.model.root.rotation.y = this.yaw;
    if (this.boardOpen) this.model.poseWave(this.time);
    else this.model.poseIdle(this.time);
    const offer = this.data.offer();
    const active = this.data.active();
    this.marker.visible = (!!offer && !active) || this.boardOpen;
    this.markerMat.color.setHex(active ? 0x3df5ff : 0xff9a3d);
    this.marker.rotation.y += dt * 2;
    this.marker.position.y = 2.35 + Math.sin(this.time * 2.5) * 0.08;
    if (this.boardOpen) {
      if (d > 7) this.closeBoard();
      this.redrawTimer -= dt;
      if (this.redrawTimer <= 0) {
        this.redrawTimer = 0.5;
        this.board.markDirty();
      }
      // Board floats beside Mika, angled toward the player.
      const side = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
      this.board.mesh.position.set(this.pos.x + side.x * 0.9, 1.45, this.pos.z + side.z * 0.9);
      this.board.mesh.lookAt(viewer.x, 1.45, viewer.z);
      this.board.refresh();
    }
  }

  private drawBoard(_ctx: CanvasRenderingContext2D): void {
    const p = this.board;
    p.drawBackground(28, 'rgba(12, 10, 26, 0.92)', '#ff9a3d');
    p.text('DISPATCH · MIKA', 40, 70, 40, '#ff9a3d', 'left', 800);
    const buttons: PanelButton[] = [];
    const active = this.data.active();
    const offer = this.data.offer();
    if (active) {
      p.text(`진행 중: ${active.title}`, 40, 140, 40, UI_COLORS.text, 'left', 700);
      p.wrap(active.description, 40, 200, 880, 30, UI_COLORS.dim);
      buttons.push({ id: 'restart', x: 40, y: 520, w: 270, h: 90, label: '처음부터 다시' });
      buttons.push({ id: 'abandon', x: 340, y: 520, w: 270, h: 90, label: '포기', style: 'danger' });
      buttons.push({ id: 'close', x: 640, y: 520, w: 280, h: 90, label: '닫기' });
    } else if (offer) {
      const can = this.data.canAccept();
      p.text(offer.title, 40, 140, 46, UI_COLORS.text, 'left', 800);
      const y = p.wrap(offer.description, 40, 200, 880, 30, UI_COLORS.dim);
      p.text(`보상 $${offer.rewards.money}`, 40, y + 30, 36, UI_COLORS.good, 'left', 700);
      if (!can.ok && can.reason) p.text(can.reason, 40, y + 80, 30, UI_COLORS.bad);
      buttons.push({ id: 'accept', x: 40, y: 520, w: 420, h: 90, label: '수락', style: 'primary', enabled: can.ok });
      buttons.push({ id: 'close', x: 500, y: 520, w: 420, h: 90, label: '닫기' });
    } else {
      p.text(this.data.allDone() ? '오늘 일은 끝! 수고했어.' : '지금은 맡길 일이 없어.', 40, 160, 40, UI_COLORS.text);
      p.wrap('도시를 자유롭게 돌아다녀. 은신처 차고(GARAGE 13)에서 저장할 수 있어.', 40, 230, 880, 30, UI_COLORS.dim);
      buttons.push({ id: 'close', x: 40, y: 520, w: 880, h: 90, label: '닫기' });
    }
    p.buttons = buttons;
    p.drawButtons();
  }

  get position(): THREE.Vector3 {
    return this.pos;
  }
}
