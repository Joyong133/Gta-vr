import * as THREE from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { sanitizeSettings, type Settings } from '../config/settings';
import { tuning } from '../config/tuning';
import { EventBus } from '../core/EventBus';
import type { GameEvents, ToastKind } from '../core/events';
import { DebugOverlay } from '../debug/DebugOverlay';
import { PerfMonitor } from '../debug/PerfMonitor';
import { DesktopInput } from '../input/DesktopInput';
import { InputRouter } from '../input/InputRouter';
import type { Grabbable } from '../interaction/Grabbable';
import { InteractionManager } from '../interaction/InteractionManager';
import { InteractorHand } from '../interaction/InteractorHand';
import { PanelInteractable } from '../interaction/PanelInteractable';
import missionData from '../missions/missions.json';
import { MissionSystem, parseMissionFile } from '../missions/MissionSystem';
import { MissionWorld } from '../missions/MissionWorld';
import type { ActionDef, MissionDef } from '../missions/types';
import { MissionGiver } from '../npc/MissionGiver';
import { PedModel } from '../npc/PedModel';
import { PedestrianManager } from '../npc/PedestrianManager';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { ComfortOverlay } from '../player/ComfortOverlay';
import { Locomotion } from '../player/Locomotion';
import { PlayerController } from '../player/PlayerController';
import { PlayerRig } from '../player/PlayerRig';
import { Teleport } from '../player/Teleport';
import { XRHands } from '../player/XRHands';
import { CrimeSystem } from '../police/CrimeSystem';
import { PoliceManager } from '../police/PoliceManager';
import { WantedSystem } from '../police/WantedSystem';
import { SaveSystem, defaultSaveData, type LoadResult, type SaveData } from '../save/SaveSystem';
import { Movers } from '../traffic/Movers';
import { TrafficManager } from '../traffic/TrafficManager';
import { CanvasPanel, UI_COLORS } from '../ui/CanvasPanel';
import { DesktopHud } from '../ui/DesktopHud';
import { Markers } from '../ui/Markers';
import { Minimap, type MapState } from '../ui/Minimap';
import { Notifier } from '../ui/Notifier';
import { WristMenu, type MenuAction } from '../ui/WristMenu';
import { PlayerVehicle } from '../vehicles/PlayerVehicle';
import { PulseBlaster } from '../weapons/PulseBlaster';
import { CityBuilder } from '../world/CityBuilder';
import { CHECKPOINTS, MISSION_GIVER, PLAYER_CAR_SPAWN, SPAWNS, ZONES, isInZone } from '../world/CityLayout';
import { Environment } from '../world/Environment';
import type { Obb2 } from '../world/geom2d';
import { Landmarks, type LandmarkResult } from '../world/Landmarks';
import { PropFactory } from '../world/PropFactory';
import { RoadNetwork } from '../world/RoadNetwork';
import { StaticWorld } from '../world/StaticWorld';
import { StreetProps } from '../world/StreetProps';

export type StartMode = 'desktop' | 'xr';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Composition root + main loop. Systems are created here and talk through the
 * event bus or narrow callbacks; the frame order is documented in frame().
 */
export class Game {
  readonly bus = new EventBus<GameEvents>();
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: PlayerRig;
  settings: Settings;
  money = 100;

  readonly physics = new PhysicsWorld();
  readonly staticWorld = new StaticWorld();
  readonly roads = new RoadNetwork();
  readonly movers = new Movers();
  readonly env: Environment;
  readonly props: PropFactory;
  readonly city: CityBuilder;
  readonly streetProps: StreetProps;
  readonly landmarks: LandmarkResult;

  readonly desktopInput: DesktopInput;
  readonly input: InputRouter;
  readonly overlay: ComfortOverlay;
  readonly teleport: Teleport;
  readonly locomotion: Locomotion;
  readonly interaction: InteractionManager;
  readonly xrHands: XRHands;
  readonly desktopHand: InteractorHand;
  private desktopHolding = false;

  readonly vehicle: PlayerVehicle;
  readonly player: PlayerController;
  readonly peds: PedestrianManager;
  readonly traffic: TrafficManager;
  readonly wanted = new WantedSystem();
  readonly police: PoliceManager;
  readonly crimes: CrimeSystem;
  readonly missions: MissionSystem;
  readonly missionWorld: MissionWorld;
  readonly giver: MissionGiver;
  private readonly clerk: PedModel;
  readonly blaster: PulseBlaster;

  readonly markers = new Markers();
  readonly notifier: Notifier;
  readonly hud = new DesktopHud();
  readonly minimap = new Minimap();
  readonly menu: WristMenu;
  readonly debug: DebugOverlay;
  readonly perf: PerfMonitor;
  readonly audio = new AudioEngine();
  readonly save: SaveSystem;
  private readonly promptPanel: CanvasPanel;
  private promptText = '';
  private readonly terminal: CanvasPanel;
  private readonly watch: CanvasPanel;

  private time = 0;
  private lastFrame = 0;
  private started = false;
  mode: StartMode = 'desktop';
  private xrPlacePending: THREE.Vector3 | null = null;
  private autosaveTimer = 60;
  private settingsSaveTimer = -1;
  private lastSafe = new THREE.Vector3();
  private safeTimer = 0;
  private zonesInside = new Set<string>();
  private lastSaveInfo = '저장 기록 없음';
  private readonly carObbs: Obb2[] = [];
  private readonly knocked: import('../npc/PedestrianManager').Pedestrian[] = [];
  private hornOn = false;
  /** Exposed for automated tests (window.neon). */
  frameCount = 0;

  constructor(container: HTMLElement) {
    // ---------- renderer / camera
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 700);
    this.rig = new PlayerRig(this.camera);
    this.scene.add(this.rig.rig);
    window.addEventListener('resize', () => this.onResize());

    // ---------- settings + save
    this.save = new SaveSystem(SaveSystem.createBrowserStorage(), new Set(parseMissionFile(missionData).map((m) => m.id)));
    this.settings = defaultSaveData().settings;

    // ---------- world
    this.env = new Environment(this.scene);
    this.props = new PropFactory(this.scene, this.physics);
    this.city = new CityBuilder(this.physics, this.staticWorld, this.roads);
    this.city.build();
    this.scene.add(this.city.group);
    this.streetProps = new StreetProps(this.physics, this.staticWorld, this.roads);
    this.streetProps.build();
    this.scene.add(this.streetProps.group);
    const lm = new Landmarks(this.city, this.staticWorld, this.physics, this.props);
    this.landmarks = lm.build();
    this.scene.add(lm.group);
    this.scene.add(this.markers.group);

    // ---------- input + player
    this.desktopInput = new DesktopInput(this.renderer.domElement);
    this.input = new InputRouter(this.desktopInput, () => this.settings);
    this.overlay = new ComfortOverlay(this.camera);
    this.vehicle = new PlayerVehicle(this.scene, this.physics, this.staticWorld, this.roads);
    this.vehicle.spawn(PLAYER_CAR_SPAWN.x, PLAYER_CAR_SPAWN.z, PLAYER_CAR_SPAWN.yaw);
    this.teleport = new Teleport(this.scene, this.staticWorld, (x, z) => this.isBlockedByMovers(x, z));
    this.interaction = new InteractionManager(this.staticWorld, () => this.rig.headWorld(_v2), {
      onGrab: (item) => this.onGrab(item),
      onRelease: (item) => this.bus.emit('item:released', { itemId: item.itemId ?? item.id }),
      onSocket: (item, socket) => {
        this.audio.play('socket', socket.worldPosition(_v));
        this.bus.emit('item:socketed', { itemId: item.itemId ?? item.id, socketId: socket.id });
      },
      onItemLost: (item) => this.toast(`${item.itemId ? '미션 아이템' : '물건'}이 원래 위치로 돌아갔습니다`, 'info'),
    });
    this.locomotion = new Locomotion(this.rig, this.staticWorld, this.teleport, this.overlay, {
      obstacles: () => this.footObstacles(),
      aimPose: () => this.input.dominant().connected ? (this.xrHands.hands.get(this.settings.comfort.dominantHand)?.ray ?? null) : null,
      movePose: () => this.xrHands.hands.get(this.settings.comfort.dominantHand === 'left' ? 'right' : 'left')?.ray ?? null,
      onStep: (p) => this.audio.play('footstep', _v.set(p.x, 0, p.z)),
      onTeleport: () => undefined,
    });
    this.xrHands = new XRHands(this.renderer, this.rig.trackingSpace, this.input, this.scene);
    this.xrHands.onChange = () => this.onXRHandsChanged();
    const deskGrip = new THREE.Object3D();
    deskGrip.position.set(0.18, -0.2, -0.45);
    this.camera.add(deskGrip);
    this.desktopHand = new InteractorHand('desktop', deskGrip, this.camera, null);
    this.desktopHand.attachCursor(this.scene);
    this.interaction.setHands([this.desktopHand]);

    this.player = new PlayerController({
      rig: this.rig,
      overlay: this.overlay,
      locomotion: this.locomotion,
      interaction: this.interaction,
      vehicle: this.vehicle,
      movers: this.movers,
      bus: this.bus,
      settings: () => this.settings,
      isXR: () => this.isXR,
      onHorn: (on) => (this.hornOn = on),
    });

    // ---------- interactables in the world
    this.interaction.register(this.vehicle.door);
    this.interaction.register(this.vehicle.wheelGrab);
    this.interaction.register(this.landmarks.storeDoor);
    this.interaction.register(this.landmarks.storeBell);
    for (const b of this.landmarks.garageButtons) this.interaction.register(b);
    for (const p of this.props.created) this.interaction.register(p);
    this.landmarks.storeDoor.onOpen = () => this.audio.play('door_open', this.landmarks.storeDoor.getAnchor(_v));
    this.landmarks.storeDoor.onClose = () => this.audio.play('door_close', this.landmarks.storeDoor.getAnchor(_v));
    this.vehicle.door.onOpen = () => this.audio.play('door_open', this.vehicle.door.getAnchor(_v));
    this.vehicle.door.onClose = () => this.audio.play('door_close', this.vehicle.door.getAnchor(_v));
    this.landmarks.garageDoor.onMove = () => this.audio.play('garage', _v.set(-12, 2, 23));
    for (const b of this.landmarks.garageButtons) {
      const prev = b.onPress;
      b.onPress = (h) => {
        prev?.(h);
        this.audio.play('button', b.getAnchor(_v));
      };
    }
    this.landmarks.storeBell.onPress = () => {
      this.audio.play('button', this.landmarks.storeBell.getAnchor(_v));
      this.audio.play('ui', this.landmarks.storeBell.getAnchor(_v));
      const waiting = this.missions.currentObjective?.id === 'take_pkg';
      this.toast(waiting ? '점원: "소포요? 카운터 위에 있어요!"' : '점원: "어서오세요, NEON 24입니다!"', 'info');
      this.clerkWave = 2.5;
    };

    // Clerk (static NPC)
    this.clerk = new PedModel({ shirt: 0x2aff9a, pants: 0x223, skin: 0xe0ac69, hair: 0x1b1b1b, accent: 0xffffff });
    this.clerk.root.position.set(43.5, 0, -24.5);
    this.clerk.root.rotation.y = -Math.PI / 2;
    this.scene.add(this.clerk.root);

    // ---------- AI
    this.peds = new PedestrianManager(this.staticWorld, this.movers);
    this.scene.add(this.peds.group);
    this.traffic = new TrafficManager(this.scene, this.physics.world, this.roads, this.movers);
    this.traffic.onHonk = (car) => this.audio.play('honk', _v.set(car.car.x, 1, car.car.z));
    this.police = new PoliceManager(this.scene, this.physics.world, this.roads, this.staticWorld, this.movers, this.wanted);
    this.scene.add(this.police.group);
    this.police.onBusted = () => void this.busted();
    this.crimes = new CrimeSystem(this.wanted, {
      policeSees: (x, z) => this.police.witnesses(x, z),
      civilianSees: (x, z, victim) => this.peds.hasWitness(x, z, victim as never),
    });
    this.crimes.onReported = (type, w) => {
      if (w === 'civilian') this.toast('목격자가 경찰에 신고했습니다', 'warn');
      else if (w === 'police' && type !== 'shots_fired') this.toast('경찰이 목격했습니다!', 'bad');
    };
    this.wanted.onChanged = (level, prev) => {
      this.bus.emit('wanted:changed', { level, prev });
      if (level > prev) {
        this.audio.play('wanted_up');
        this.toast(`수배 ${'★'.repeat(level)}`, 'bad');
      }
    };
    this.wanted.onCleared = (prev) => {
      this.bus.emit('wanted:cleared', { level: prev });
      this.toast('경찰을 따돌렸다! 수배 해제', 'good');
      this.audio.play('checkpoint');
      this.crimes.clearPending();
      this.requestAutosave();
    };

    // Physics-step hooks (run inside every fixed 60 Hz sub-step).
    this.physics.onFixedStep((h) => {
      this.vehicle.fixedUpdate(h);
      this.traffic.fixedUpdate(h, this.time);
      this.police.fixedUpdate(h);
    });
    this.vehicle.onImpact = (info) => this.onCarImpact(info.speed, info.other, info.point);

    // ---------- weapon
    this.blaster = new PulseBlaster(this.scene, this.physics, this.staticWorld, {
      hitLiving: (p, r) => {
        const ped = this.peds.hitTest(p.x, p.y, p.z, r);
        if (ped) return { kind: 'ped', target: ped };
        const o = this.police.officerHitTest(p.x, p.y, p.z, r);
        return o ? { kind: 'officer', target: o } : null;
      },
      onFire: (origin) => {
        this.audio.play('blaster', origin);
        this.crimes.commit('shots_fired', origin.x, origin.z);
        this.peds.danger(origin.x, origin.z, 25, 1.2);
      },
      onHit: (hit) => {
        this.audio.play('zap_hit', hit.point);
        if (hit.kind === 'ped') {
          const ped = hit.target as import('../npc/PedestrianManager').Pedestrian;
          ped.knockDown(hit.point.x - 0.5, hit.point.z - 0.5);
          this.crimes.commit('assault_civilian', hit.point.x, hit.point.z, ped);
          this.peds.danger(hit.point.x, hit.point.z, 18, 2);
        } else if (hit.kind === 'officer') {
          (hit.target as { stunned: number }).stunned = 2.5;
          this.crimes.commit('assault_police', hit.point.x, hit.point.z);
        } else if (hit.kind === 'body' && hit.tag) {
          if (hit.tag.kind === 'police') this.crimes.commit('assault_police', hit.point.x, hit.point.z);
          if (hit.tag.kind === 'traffic') this.traffic.byId(hit.tag.id)?.stun(2);
        }
      },
    }, this.landmarks.blasterSpawn);
    this.blaster.grabbable.setHome(this.landmarks.blasterSpawn);
    this.interaction.register(this.blaster.grabbable);

    // ---------- missions
    this.missions = new MissionSystem(parseMissionFile(missionData), {
      runAction: (a, m) => this.runMissionAction(a, m),
      giveMoney: (n) => this.addMoney(n),
      onStarted: (m) => {
        this.audio.play('mission_start');
        this.toast(`미션 시작: ${m.title}`, 'info');
        this.bus.emit('mission:started', { id: m.id });
      },
      onObjective: (m, i, o) => {
        this.bus.emit('mission:objective', { id: m.id, index: i, text: o.text });
        if (i > 0) this.audio.play('checkpoint');
        this.toast(o.text, 'info', 4);
        this.requestAutosave();
      },
      onCompleted: (m, reward) => {
        this.audio.play('mission_complete');
        this.audio.play('cash');
        this.toast(`미션 완료: ${m.title}  +$${reward}`, 'good', 5);
        this.missionWorld.showCheckpoints(null);
        if (m.next) this.toast('MIKA에게 다음 일을 받아 보세요', 'info', 5);
        this.bus.emit('mission:completed', { id: m.id, reward });
        this.doSave('미션 완료 자동 저장');
      },
      onFailed: (m, reason) => {
        this.audio.play('mission_fail');
        this.toast(`미션 실패: ${reason} — 손목 메뉴/MIKA에서 재시작`, 'bad', 5);
        this.missionWorld.resetAll();
        this.bus.emit('mission:failed', { id: m.id, reason });
      },
      onCheckpoint: (_m, _id, index, total) => {
        this.audio.play('checkpoint');
        this.toast(`체크포인트 ${index}/${total}`, 'good', 1.5);
      },
    });
    this.missionWorld = new MissionWorld(this.props, this.interaction, this.markers, this.vehicle, {
      playerPos: (out) => this.player.position(out),
      isDriving: () => this.player.driving,
      wantedLevel: () => this.wanted.level,
    }, this.landmarks.dropboxAnchor);

    this.giver = new MissionGiver(this.scene, MISSION_GIVER.id, MISSION_GIVER.x, MISSION_GIVER.z, {
      offer: () => this.missions.nextAvailable(MISSION_GIVER.id),
      active: () => this.missions.activeDef,
      canAccept: () => {
        const m = this.missions.nextAvailable(MISSION_GIVER.id);
        return m ? this.missions.canStart(m.id, this.wanted.level) : { ok: false };
      },
      accept: () => {
        const m = this.missions.nextAvailable(MISSION_GIVER.id);
        if (m) this.missions.start(m.id, this.wanted.level);
      },
      restart: () => this.restartMission(),
      abandon: () => this.abandonMission(),
      allDone: () => this.missions.completed.size === this.missions.defs.size,
    });
    this.giver.talk.onTalk = () => {
      this.giver.openBoard();
      this.audio.play('ui', this.giver.position);
      this.bus.emit('npc:talk', { npcId: MISSION_GIVER.id });
    };
    this.interaction.register(this.giver.talk);
    this.interaction.register(this.giver.boardInteractable);
    this.bus.on('npc:talk', (e) => this.missions.handle({ type: 'talk', npc: e.npcId }));
    this.bus.on('toast', (t) => this.toast(t.text, t.kind ?? 'info', t.duration));

    // ---------- UI
    this.notifier = new Notifier(this.scene, this.camera);
    this.menu = new WristMenu(
      {
        money: () => this.money,
        wanted: () => ({ level: this.wanted.level, searching: this.wanted.searching, cooldown: this.wanted.cooldownProgress }),
        mission: () => {
          const m = this.missions.activeDef;
          if (!m) return null;
          const cp = this.missions.checkpointProgress;
          return { title: m.title, objective: this.missions.currentObjective?.text ?? '', timeLeft: this.missions.timeLeft(), progress: cp ? `체크포인트 ${cp.index}/${cp.total}` : null };
        },
        settings: () => this.settings,
        changeSettings: (fn) => this.changeSettings(fn),
        mapState: () => this.mapState(),
        debugEnabled: () => this.debug.enabled,
        saveInfo: () => this.lastSaveInfo,
        inVehicle: () => this.player.driving,
        run: (a) => this.runMenuAction(a),
      },
      this.minimap,
    );
    this.menu.onClick = () => this.audio.play('ui');
    const menuInteractable = new PanelInteractable('wrist_menu', this.menu.panel);
    menuInteractable.maxFarDistance = 1.5;
    this.interaction.register(menuInteractable);
    this.debug = new DebugOverlay(this.scene, this.camera);
    this.perf = new PerfMonitor(this.renderer);

    // World-space prompt label (VR) and the safehouse save terminal.
    this.promptPanel = new CanvasPanel(640, 110, 0.5, { depthTest: false });
    this.promptPanel.mesh.renderOrder = 800;
    this.promptPanel.mesh.visible = false;
    this.promptPanel.draw = (ctx) => {
      ctx.fillStyle = 'rgba(8,10,22,0.85)';
      ctx.fillRect(0, 0, 640, 110);
      ctx.strokeStyle = UI_COLORS.border;
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, 636, 106);
      this.promptPanel.text(this.promptText, 320, 70, 40, '#fff', 'center', 700);
    };
    this.scene.add(this.promptPanel.mesh);
    this.terminal = new CanvasPanel(600, 400, 0.85);
    this.landmarks.saveTerminalAnchor.add(this.terminal.mesh);
    this.terminal.mesh.position.z = 0.01;
    this.terminal.draw = (ctx) => this.drawTerminal(ctx);
    this.terminal.onButton = (id) => {
      if (id === 'save') this.doSave('은신처 터미널에서 저장');
      this.terminal.markDirty();
    };
    this.interaction.register(new PanelInteractable('save_terminal', this.terminal));
    this.watch = new CanvasPanel(512, 180, 0.13, { depthTest: true });
    this.watch.mesh.visible = false;
    this.watch.draw = (ctx) => this.drawWatch(ctx);

    this.bus.on('item:socketed', () => this.requestAutosave());
    this.lastSafe.set(SPAWNS.plaza.x, 0, SPAWNS.plaza.z);
    this.applySettings();
    this.rig.spawnAt(SPAWNS.plaza.x, SPAWNS.plaza.z, 0, SPAWNS.plaza.yaw);
    this.locomotion.warp(SPAWNS.plaza.x, SPAWNS.plaza.z);
    this.renderer.setAnimationLoop((t, f) => this.frame(t, f));
  }

  private clerkWave = 0;

  get isXR(): boolean {
    return this.renderer.xr.isPresenting;
  }

  // =====================================================================
  // Start / XR session
  // =====================================================================

  /** Loads (or ignores) the save and starts gameplay. */
  start(mode: StartMode, opts: { newGame: boolean; seated: boolean; leftHanded: boolean }): LoadResult {
    this.mode = mode;
    this.audio.resume();
    const result = opts.newGame ? { data: defaultSaveData(), status: 'missing' as const, notes: ['새 게임'] } : this.save.load();
    if (opts.newGame) this.save.clear();
    this.applySave(result.data, true);
    if (opts.seated) this.settings.comfort.stance = 'seated';
    if (opts.leftHanded) this.settings.comfort.dominantHand = 'left';
    this.applySettings();
    this.started = true;
    this.hud.setVisible(mode === 'desktop');
    const msg: Record<string, [string, ToastKind]> = {
      ok: ['저장 데이터를 불러왔습니다', 'good'],
      missing: ['새 게임 시작 — 광장의 MIKA를 찾아가세요', 'info'],
      repaired: ['저장 데이터 일부를 복구했습니다', 'warn'],
      'corrupt-recovered-backup': ['저장 파일 손상 → 백업에서 복구했습니다', 'warn'],
      'corrupt-defaults': ['저장 파일 손상 → 기본값으로 시작합니다', 'warn'],
    };
    const [text, kind] = msg[result.status];
    this.toast(text, kind, 5);
    this.lastSaveInfo = `불러오기 상태: ${result.status}${result.notes.length ? ' (' + result.notes.join(', ') + ')' : ''}`;
    if (mode === 'desktop') this.desktopInput.requestPointerLock();
    return result;
  }

  async enterXR(): Promise<void> {
    const xr = navigator.xr;
    if (!xr) throw new Error('WebXR unavailable');
    this.renderer.xr.setFramebufferScaleFactor(this.settings.graphics.quality === 'low' ? 0.8 : 1.0);
    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    await this.renderer.xr.setSession(session as unknown as XRSession);
    this.renderer.xr.setFoveation(this.settings.graphics.quality === 'high' ? 0.2 : 0.5);
    this.rig.xr = true;
    this.input.xrActive = true;
    this.player.position(_v);
    this.xrPlacePending = _v.clone();
    this.notifier.xr = true;
    this.debug.setXR(true);
    this.hud.setVisible(false);
    this.onXRHandsChanged();
    session.addEventListener('end', () => this.onXREnd());
  }

  private onXREnd(): void {
    this.rig.xr = false;
    this.input.xrActive = false;
    this.notifier.xr = false;
    this.debug.setXR(false);
    this.hud.setVisible(true);
    this.menu.attachTo(null);
    this.watch.mesh.removeFromParent();
    this.interaction.setHands([this.desktopHand]);
    this.player.position(_v);
    this.rig.rig.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rig.headYaw());
    this.rig.placeHeadAt(_v.x, _v.z, this.rig.rig.position.y);
  }

  private onXRHandsChanged(): void {
    if (!this.isXR) return;
    const hands = this.xrHands.list();
    this.interaction.setHands(hands);
    const off = this.xrHands.hands.get(this.settings.comfort.dominantHand === 'left' ? 'right' : 'left');
    if (off) {
      this.menu.attachTo(off.grip);
      this.menu.setOpen(this.menu.open);
      off.grip.add(this.watch.mesh);
      this.watch.mesh.position.set(0, 0.035, 0.07);
      this.watch.mesh.rotation.set(-Math.PI / 2, 0, 0);
    }
  }

  // =====================================================================
  // Frame
  // =====================================================================

  private frame(timeMs: number, xrFrame?: XRFrame): void {
    const t = timeMs / 1000;
    let dt = this.lastFrame ? t - this.lastFrame : 1 / 60;
    this.lastFrame = t;
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    this.frameCount++;
    const perf = this.perf;
    perf.begin('update');

    // 1. Input
    const session = this.renderer.xr.getSession();
    this.input.updateXR(session && xrFrame ? session.inputSources : null);
    if (this.isXR) this.xrHands.feedInputs();
    this.input.update();
    const a = this.input.actions;
    this.rig.setHeightOffset(this.settings.comfort.heightOffset);
    this.rig.syncHead(this.renderer);
    if (this.xrPlacePending && this.isXR) {
      const p = this.xrPlacePending;
      this.xrPlacePending = null;
      if (!this.player.driving) this.rig.placeHeadAt(p.x, p.z, 0);
    }
    if (!this.isXR) this.feedDesktopHand();
    else this.blaster.aimOverride = null;

    // 2. Global actions
    if (this.started) {
      if (a.menu) this.toggleMenu();
      if (a.debug) this.debug.toggle();
      if (a.tuning && !this.isXR) this.debug.toggleTuning();
    }

    // 3. Movers snapshot (AI reads it during the physics steps)
    this.publishMovers();

    // 4. Player (locomotion or driving input)
    const menuBlocks = this.menu.open && !this.isXR;
    if (this.started && !menuBlocks) this.player.update(dt, a);
    else if (this.player.driving) {
      const c = this.vehicle.physics.controls;
      c.throttle = 0;
      c.brake = 0.5;
    }
    if (this.started && !this.player.driving && a.interact && !this.player.busy) this.contextInteract();

    // 5. Physics (fixed steps run vehicle + AI kinematics)
    perf.begin('physics');
    this.physics.step(dt);
    perf.end('physics');

    // 6. Vehicle visual + seat
    this.vehicle.update(dt);
    if (this.player.driving) this.player.applySeat();

    // 7. Hands / interaction (after the rig moved this frame)
    perf.begin('interaction');
    if (this.started) this.interaction.update(dt);
    this.blaster.update(dt);
    perf.end('interaction');

    // 8. AI
    perf.begin('ai');
    this.player.position(_v);
    this.rig.headWorld(_v2);
    this.traffic.syncVisuals(dt, _v2);
    this.peds.update(dt, _v2);
    this.police.playerInCar = this.player.driving;
    this.police.playerSpeed = this.player.driving ? this.vehicle.speed : this.locomotion.speed;
    this.police.playerY = this.player.driving ? 1.0 : _v2.y;
    this.police.update(dt, _v2);
    this.checkCarHits();
    this.giver.update(dt, _v2);
    this.updateClerk(dt);
    perf.end('ai');

    // 9. Rules: wanted, crimes, missions, zones
    this.wanted.update(dt, _v.x, _v.z);
    this.crimes.update(dt);
    if (this.started) {
      this.missions.update(dt, this.missionWorld);
      this.missionWorld.update(this.missions);
      this.updateZones();
      this.updateSafePosition(dt);
      this.updateAutosave(dt);
    }

    // 10. World animation
    this.landmarks.storeDoor.update(dt);
    this.landmarks.storeBell.update(dt);
    for (const b of this.landmarks.garageButtons) b.update(dt);
    this.landmarks.garageDoor.update(dt);
    this.streetProps.updateLights(this.time);
    for (const s of this.city.signs) s.update(dt);
    for (const s of this.landmarks.signs) s.update(dt);
    this.env.update(_v);

    // 11. UI + audio
    perf.begin('ui');
    this.updateUI(dt);
    perf.end('ui');
    this.updateAudio(dt);
    this.overlay.update(dt);
    perf.end('update');

    // 12. Render
    perf.begin('render');
    perf.beginGpu();
    this.renderer.render(this.scene, this.camera);
    perf.endGpu();
    perf.end('render');
    perf.frame(dt);
  }

  private feedDesktopHand(): void {
    const d = this.desktopInput;
    const h = this.desktopHand;
    const menuOpen = this.menu.open;
    const grabPress = !menuOpen && (d.pressed('KeyF') || d.mouseRightDown);
    h.gripDown = false;
    h.gripUp = false;
    // Holding state reflects last frame (an item may have been dropped/socketed meanwhile).
    if (!h.held) this.desktopHolding = false;
    if (grabPress) {
      if (this.desktopHolding) {
        this.desktopHolding = false;
        h.gripUp = true;
      } else if (h.hover?.grabbable) {
        this.desktopHolding = true;
        h.gripDown = true;
      }
    }
    if (d.pressed('KeyG') && h.held) {
      this.desktopHolding = false;
      this.camera.getWorldDirection(_v);
      this.interaction.throwFromHand(h, _v.multiplyScalar(9).add(new THREE.Vector3(0, 2, 0)));
    }
    h.gripHeld = this.desktopHolding;
    h.triggerDown = !menuOpen && d.mouseLeftDown && d.pointerLocked;
    h.triggerUp = !d.mouseLeft;
    h.triggerHeld = d.mouseLeft;
    h.triggerValue = d.mouseLeft ? 1 : 0;
    // Blaster aims along the view on desktop.
    this.blaster.aimOverride = this.isXR
      ? null
      : () => {
          const origin = this.camera.getWorldPosition(new THREE.Vector3());
          const dir = this.camera.getWorldDirection(new THREE.Vector3());
          origin.addScaledVector(dir, 0.6);
          return { origin, dir };
        };
  }

  /** A / E on foot: talk to MIKA, else select what the desktop ray points at. */
  private contextInteract(): void {
    if (this.player.nearCarDoor()) return; // handled by PlayerController
    this.rig.headWorld(_v);
    if (Math.hypot(_v.x - MISSION_GIVER.x, _v.z - MISSION_GIVER.z) < 3.2) {
      this.giver.talk.select(this.desktopHand);
      return;
    }
    if (!this.isXR && this.desktopHand.hover && !this.desktopHand.hover.grabbable) {
      this.desktopHand.hover.select(this.desktopHand, this.desktopHand.hoverPoint);
    }
  }

  private publishMovers(): void {
    const m = this.movers;
    m.clear();
    this.player.position(_v);
    m.playerX = _v.x;
    m.playerZ = _v.z;
    m.playerOnFoot = !this.player.driving;
    m.cars.push({ id: this.vehicle.id, kind: 'player_car', obb: this.vehicle.obb, speed: this.vehicle.speed });
    this.traffic.publish();
    this.police.publish();
    this.peds.publish();
    if (!this.player.driving) m.walkers.push({ x: _v.x, z: _v.z, r: 0.3 });
  }

  private footObstacles(): Obb2[] {
    this.carObbs.length = 0;
    for (const c of this.movers.cars) this.carObbs.push(c.obb);
    const door = this.landmarks.storeDoor;
    if (door.blocksPlayer && !door.isDragged) this.carObbs.push(door.obb);
    return this.carObbs;
  }

  private isBlockedByMovers(x: number, z: number): boolean {
    for (const c of this.movers.cars) {
      if (Math.abs(c.obb.cx - x) < 2.6 && Math.abs(c.obb.cz - z) < 2.6) return true;
    }
    return false;
  }

  private checkCarHits(): void {
    if (!this.player.driving) return;
    const speed = this.vehicle.speed;
    if (speed < 0.5) return;
    this.peds.checkCarHits(this.vehicle.obb, speed, this.knocked);
    for (const p of this.knocked) {
      this.crimes.commit('hit_pedestrian', p.x, p.z, p);
      this.peds.danger(p.x, p.z, 20, 2);
      this.hapticBoth(0.8, 120);
      this.audio.impact(_v.set(p.x, 1, p.z), 0.4);
    }
    const o = this.police.checkCarHits(this.vehicle.obb, speed);
    if (o) {
      this.crimes.commit('assault_police', o.x, o.z);
      this.hapticBoth(0.8, 120);
    }
    // Speeding toward people makes them jump away.
    if (speed > 8) {
      const f = this.vehicle.physics.chassis;
      const fx = -Math.sin(this.vehicle.physics.yaw());
      const fz = -Math.cos(this.vehicle.physics.yaw());
      this.peds.danger(f.position.x + fx * 8, f.position.z + fz * 8, 5, 0.6);
    }
  }

  private onCarImpact(speed: number, other: { kind: string; id: string } | null, point: THREE.Vector3): void {
    const s = Math.min(1, speed / 12);
    if (speed > tuning.vehicle.impactHapticSpeed && this.player.driving) this.hapticBoth(0.3 + s * 0.7, 60 + s * 120);
    this.audio.impact(point, s);
    this.peds.danger(point.x, point.z, 8 + s * 14, 0.8 + s);
    if (!other) return;
    if (other.kind === 'police' && speed > 2.5 && this.player.driving) this.crimes.commit('hit_police_vehicle', point.x, point.z);
    if (other.kind === 'traffic') {
      const tc = this.traffic.byId(other.id);
      if (tc) {
        tc.stun(2.5);
        const b = this.vehicle.body.velocity;
        tc.car.knock(b.x * 0.3, b.z * 0.3, (Math.random() - 0.5) * 0.6);
        this.audio.play('honk', point);
      }
    }
  }

  private hapticBoth(intensity: number, ms: number): void {
    this.input.left.pulse(intensity, ms);
    this.input.right.pulse(intensity, ms);
  }

  /** Debug/QA: the active hand grabs an item directly (bypasses aiming). */
  debugGrab(id: string): boolean {
    const item = this.interaction.interactables.find((i) => i.id === id);
    const hand = this.interaction.hands[0];
    if (!item || !(item as Grabbable).grab || !hand || !item.grabbable) return false;
    (item as Grabbable).grab(hand, false);
    this.onGrab(item as Grabbable);
    if (hand === this.desktopHand) this.desktopHolding = true;
    return true;
  }

  /** Debug/QA: world position beside the driver's door. */
  driverDoorSpot(): THREE.Vector3 {
    const yaw = this.vehicle.physics.yaw();
    const p = this.vehicle.worldPosition(new THREE.Vector3());
    // Driver side = car local -X.
    return p.add(new THREE.Vector3(-1.7, 0, -0.1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)).setY(0);
  }

  private onGrab(item: Grabbable): void {
    this.audio.play('grab', item.object.position);
    this.bus.emit('item:grabbed', { itemId: item.itemId ?? item.id });
  }

  private updateClerk(dt: number): void {
    this.clerkWave = Math.max(0, this.clerkWave - dt);
    if (this.clerkWave > 0) this.clerk.poseWave(this.time);
    else this.clerk.poseIdle(this.time);
  }

  private updateZones(): void {
    this.player.position(_v);
    for (const z of ZONES) {
      const inside = isInZone(z, _v.x, _v.z);
      const was = this.zonesInside.has(z.id);
      if (inside && !was) {
        this.zonesInside.add(z.id);
        this.bus.emit('zone:enter', { zoneId: z.id });
        if (z.id === 'safehouse' && this.wanted.level === 0) this.toast('은신처 — 터미널에서 저장할 수 있습니다', 'info');
      } else if (!inside && was) {
        this.zonesInside.delete(z.id);
        this.bus.emit('zone:exit', { zoneId: z.id });
      }
    }
  }

  /** Remembers a safe on-foot position (no wanted level, walkable) for saving. */
  private updateSafePosition(dt: number): void {
    this.safeTimer -= dt;
    if (this.safeTimer > 0) return;
    this.safeTimer = 2;
    if (this.wanted.level > 0) return;
    this.player.position(_v);
    if (this.player.driving) {
      // A spot beside the car.
      const yaw = this.vehicle.physics.yaw();
      _v.x += Math.cos(yaw) * -2.2;
      _v.z += -Math.sin(yaw) * -2.2;
    }
    if (!this.staticWorld.isCircleBlocked(_v.x, _v.z, 0.35) && Math.abs(_v.x) < 140 && Math.abs(_v.z) < 140) this.lastSafe.set(_v.x, 0, _v.z);
  }

  // =====================================================================
  // UI
  // =====================================================================

  private updateUI(dt: number): void {
    this.notifier.update(dt);
    this.markers.update(dt);
    const target = this.missionWorld.targetPosition(this.missions, _v);
    this.player.position(_v2);
    const near = !!target && Math.hypot(_v.x - _v2.x, _v.z - _v2.z) < 14;
    this.markers.setBeacon(target ? _v.clone() : null, near);
    // Dashboard
    if (this.player.driving || this.vehicle.speed > 0.5) {
      const tgt = target ? _v.clone() : null;
      const carPos = this.vehicle.worldPosition(_v2);
      this.vehicle.dashboard.update(dt, {
        speedKmh: this.vehicle.speedKmh,
        gear: this.vehicle.physics.forwardSpeed < -0.3 ? 'R' : this.vehicle.speed < 0.3 ? 'N' : 'D',
        wanted: this.wanted.level,
        searching: this.wanted.searching,
        objective: this.missions.currentObjective?.text ?? (this.missions.activeDef ? '' : '자유 주행'),
        distance: tgt ? Math.hypot(tgt.x - carPos.x, tgt.z - carPos.z) : null,
        prompt: this.player.driving ? this.player.prompt(this.isXR) : null,
        money: this.money,
      });
      const arrow = this.vehicle.visual.gpsArrow!;
      arrow.visible = !!tgt;
      if (tgt) {
        // Direction to target in the car's local frame.
        _q.copy(this.vehicle.visual.root.quaternion).invert();
        const dir = tgt.sub(carPos).applyQuaternion(_q);
        arrow.rotation.y = Math.atan2(dir.x, dir.z);
      }
    }
    this.menu.update(dt);
    // Desktop HUD
    const prompt = this.currentPrompt();
    if (!this.isXR) {
      const m = this.missions.activeDef;
      this.hud.update({
        money: this.money,
        wanted: this.wanted.level,
        searching: this.wanted.searching,
        missionTitle: m?.title ?? null,
        objective: this.missions.currentObjective?.text ?? null,
        timeLeft: this.missions.timeLeft(),
        prompt,
        inVehicle: this.player.driving,
        speedKmh: this.vehicle.speedKmh,
      });
    }
    this.updatePromptPanel(prompt);
    this.updateWatch(dt);
    this.terminalTimer -= dt;
    if (this.terminalTimer <= 0) {
      this.terminalTimer = 1;
      this.terminal.markDirty();
    }
    this.terminal.refresh();
    if (this.debug.enabled) this.updateDebug();
    this.debug.update(dt);
  }

  private terminalTimer = 0;
  private watchTimer = 0;

  private currentPrompt(): string | null {
    const p = this.player.prompt(this.isXR);
    if (p && !this.player.driving) return p;
    if (this.player.driving) return null;
    this.rig.headWorld(_v);
    if (Math.hypot(_v.x - MISSION_GIVER.x, _v.z - MISSION_GIVER.z) < 3.2 && !this.giver.boardOpen) return `[${this.isXR ? 'A' : 'E'}] MIKA와 대화`;
    if (!this.isXR) {
      const h = this.desktopHand.hover;
      if (this.desktopHand.held) return this.desktopHand.held.id === 'volt_pulse' ? '[클릭] 발사 · [F] 놓기 · [G] 던지기' : '[F] 놓기 · [G] 던지기';
      if (h) return h.grabbable ? `[F] ${h.verb}` : `[클릭/E] ${h.verb}`;
    }
    return null;
  }

  private updatePromptPanel(prompt: string | null): void {
    const show = this.isXR && !!prompt && !this.player.driving;
    this.promptPanel.mesh.visible = show;
    if (!show || !prompt) return;
    if (prompt !== this.promptText) {
      this.promptText = prompt;
      this.promptPanel.markDirty();
      this.promptPanel.refresh();
    }
    // Place near what the prompt refers to (car door or MIKA), else in front of the player.
    if (this.player.nearCarDoor()) this.vehicle.door.getAnchor(_v).add(new THREE.Vector3(0, 0.6, 0));
    else _v.set(MISSION_GIVER.x, 2.0, MISSION_GIVER.z);
    this.promptPanel.mesh.position.copy(_v);
    this.rig.headWorld(_v2);
    this.promptPanel.mesh.lookAt(_v2);
  }

  private updateWatch(dt: number): void {
    if (!this.isXR || !this.watch.mesh.parent) {
      this.watch.mesh.visible = false;
      return;
    }
    // Show the wrist status only when the wrist is turned toward the face.
    this.watch.mesh.getWorldPosition(_v);
    this.rig.headWorld(_v2);
    const n = new THREE.Vector3(0, 0, 1).transformDirection(this.watch.mesh.matrixWorld);
    const toHead = _v2.sub(_v).normalize();
    this.watch.mesh.visible = n.dot(toHead) > 0.55 && !this.menu.open;
    this.watchTimer -= dt;
    if (this.watch.mesh.visible && this.watchTimer <= 0) {
      this.watchTimer = 0.3;
      this.watch.markDirty();
      this.watch.refresh();
    }
  }

  private drawWatch(_ctx: CanvasRenderingContext2D): void {
    const p = this.watch;
    p.drawBackground(24);
    p.text(`$${this.money}`, 24, 70, 52, UI_COLORS.good, 'left', 800);
    p.text('★'.repeat(this.wanted.level) + '☆'.repeat(3 - this.wanted.level), 488, 70, 52, this.wanted.level ? UI_COLORS.warn : '#3a4166', 'right');
    const o = this.missions.currentObjective?.text ?? 'Y: 메뉴 · MIKA에게 미션 받기';
    p.text(o.length > 22 ? o.slice(0, 22) + '…' : o, 24, 140, 30, UI_COLORS.text);
  }

  private drawTerminal(_ctx: CanvasRenderingContext2D): void {
    const p = this.terminal;
    p.drawBackground(20, 'rgba(6,18,14,0.95)', UI_COLORS.good);
    p.text('SAFEHOUSE TERMINAL', 30, 60, 34, UI_COLORS.good, 'left', 800);
    p.text(`보유 금액 $${this.money}`, 30, 120, 30, UI_COLORS.text);
    p.text(`완료한 미션 ${this.missions.completed.size}/${this.missions.defs.size}`, 30, 165, 30, UI_COLORS.text);
    const can = this.wanted.level === 0;
    p.wrap(can ? this.lastSaveInfo : '수배 중에는 저장할 수 없습니다', 30, 215, 540, 24, can ? UI_COLORS.dim : UI_COLORS.bad);
    p.buttons = [{ id: 'save', x: 30, y: 290, w: 540, h: 90, label: '진행 상황 저장', style: 'primary', enabled: can }];
    p.drawButtons();
  }

  private toggleMenu(): void {
    this.menu.toggle();
    if (this.isXR) return;
    const wrap = document.getElementById('menuCanvasWrap');
    if (!wrap) return;
    if (this.menu.open) {
      wrap.innerHTML = '';
      wrap.appendChild(this.menu.panel.canvas);
      wrap.classList.remove('hidden');
      document.exitPointerLock?.();
      this.menu.panel.refresh(true);
      const canvas = this.menu.panel.canvas;
      const toPx = (e: MouseEvent): [number, number] => {
        const r = canvas.getBoundingClientRect();
        return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height];
      };
      canvas.onclick = (e) => {
        const [x, y] = toPx(e);
        this.menu.panel.click(x, y);
        this.menu.panel.refresh(true);
      };
      canvas.onmousemove = (e) => {
        const [x, y] = toPx(e);
        this.menu.panel.setHover(this.menu.panel.buttonAt(x, y)?.id ?? null);
        this.menu.panel.refresh();
      };
      wrap.onclick = (e) => {
        if (e.target === wrap) this.toggleMenu();
      };
    } else {
      wrap.classList.add('hidden');
      if (this.started) this.desktopInput.requestPointerLock();
    }
  }

  private mapState(): MapState {
    this.player.position(_v);
    const yaw = this.player.driving ? this.vehicle.physics.yaw() : this.rig.headYaw();
    const target = this.missionWorld.targetPosition(this.missions, _v2);
    const cps: MapState['checkpoints'] = [];
    const obj = this.missions.currentObjective;
    if (obj?.type === 'checkpoints') {
      for (const id of obj.checkpoints ?? []) {
        const c = CHECKPOINTS.find((cp) => cp.id === id);
        if (c) cps.push({ x: c.x, z: c.z, next: id === this.missions.nextCheckpointId });
      }
    }
    const police: MapState['police'] = [];
    for (const u of this.police.units) {
      const ux = u.kind === 'car' ? u.car.x : u.x;
      const uz = u.kind === 'car' ? u.car.z : u.z;
      // Radar: only units close to the player are shown.
      if (Math.hypot(ux - _v.x, uz - _v.z) < 90) police.push({ x: ux, z: uz, pursuing: u.state === 'pursue' });
    }
    const vp = this.vehicle.worldPosition(new THREE.Vector3());
    return {
      playerX: _v.x,
      playerZ: _v.z,
      playerYaw: yaw,
      target: target ? { x: target.x, z: target.z } : null,
      police,
      search: this.wanted.level > 0 && this.wanted.searching && this.wanted.hasLkp ? { x: this.wanted.lkpX, z: this.wanted.lkpZ, r: this.wanted.searchRadius } : null,
      car: this.player.driving ? null : { x: vp.x, z: vp.z },
      checkpoints: cps,
      giver: this.missions.activeDef ? null : { x: MISSION_GIVER.x, z: MISSION_GIVER.z },
    };
  }

  private updateDebug(): void {
    const p = this.perf;
    const info = this.renderer.info;
    const w = this.wanted;
    this.player.position(_v);
    const lines = [
      `NEON DISTRICT VR  debug   mode=${this.isXR ? 'XR' : 'desktop'}`,
      `fps ${p.fps.toFixed(0)}  frame ${p.frameMs.toFixed(1)}ms (max ${p.frameMsMax.toFixed(1)})  gpu ${p.gpuMs !== null ? p.gpuMs.toFixed(2) + 'ms' : (p.gpuTimerAvailable ? '...' : 'n/a')}`,
      `cpu ms: update ${p.sectionMs('update').toFixed(2)} | physics ${p.sectionMs('physics').toFixed(2)} | ai ${p.sectionMs('ai').toFixed(2)} | interact ${p.sectionMs('interaction').toFixed(2)} | ui ${p.sectionMs('ui').toFixed(2)} | render(submit) ${p.sectionMs('render').toFixed(2)}`,
      `draw calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k  geo ${info.memory.geometries}  tex ${info.memory.textures}  bodies ${this.physics.world.bodies.length}`,
      `player ${this.player.mode} pos ${_v.x.toFixed(1)},${_v.z.toFixed(1)}  busy=${this.player.busy}`,
      `car speed ${this.vehicle.speedKmh.toFixed(0)}km/h up ${this.vehicle.physics.upY().toFixed(2)} flipped ${this.vehicle.physics.isFlipped} stuck ${this.vehicle.physics.isStuck} wheels ${this.vehicle.physics.vehicle.numWheelsOnGround}`,
      `WANTED ${w.level}  searching ${w.searching}  seen ${w.timeSinceSeen === Infinity ? '-' : w.timeSinceSeen.toFixed(1) + 's'}  cooldown ${(w.cooldownProgress * 100).toFixed(0)}%  LKP ${w.hasLkp ? w.lkpX.toFixed(0) + ',' + w.lkpZ.toFixed(0) : '-'} r=${w.searchRadius}`,
      `arrest ${(this.police.arrestProgress * 100).toFixed(0)}%  crimes: ${this.crimes.log.join(' / ')}`,
      '--- police',
      ...this.police.units.map((u) => `${u.id.padEnd(13)} ${u.state.padEnd(8)} sees=${u.sees ? 'Y' : 'n'} dist=${u.distToPlayer.toFixed(0)}m tgt=${u.targetX.toFixed(0)},${u.targetZ.toFixed(0)}`),
      '--- pedestrians ' + Object.entries(this.peds.stateCounts()).map(([k, v]) => `${k}:${v}`).join(' '),
      ...this.peds.nearest(_v.x, _v.z, 4).map((pd) => `${pd.id.padEnd(7)} ${pd.state.padEnd(7)} d=${Math.hypot(pd.x - _v.x, pd.z - _v.z).toFixed(1)} turnarounds=${pd.stuckTurnarounds}`),
      '--- traffic',
      ...this.traffic.cars.slice(0, 8).map((c) => `${c.car.id.padEnd(10)} ${c.state.padEnd(13)} v=${c.car.speed.toFixed(1)} ${c.reason}`),
      '--- mission',
      `${this.missions.activeDef?.id ?? '(none)'} obj=${this.missions.currentObjective?.id ?? '-'} completed=[${[...this.missions.completed].join(',')}] money=${this.money}`,
    ];
    this.debug.setLines(lines);
    const segs = this.police.units.map((u) => {
      const ux = u.kind === 'car' ? u.car.x : u.x;
      const uz = u.kind === 'car' ? u.car.z : u.z;
      return { ax: ux, ay: 1.5, az: uz, bx: _v.x, by: 1.2, bz: _v.z, sees: u.sees };
    });
    this.debug.setSight(segs);
    this.debug.setSearch(w.level > 0 && w.hasLkp ? { x: w.lkpX, z: w.lkpZ, r: w.searchRadius } : null);
  }

  // =====================================================================
  // Audio
  // =====================================================================

  private updateAudio(dt: number): void {
    if (!this.audio.ctx) return;
    this.audio.updateListener(this.camera);
    const carPos = this.vehicle.worldPosition(_v);
    const c = this.vehicle.physics.controls;
    this.audio.updateEngine(carPos, this.vehicle.speed, this.player.driving ? Math.max(c.throttle, c.brake * 0.5) : 0, this.player.driving || this.vehicle.speed > 1);
    this.audio.setHorn(this.hornOn && this.player.driving, carPos);
    this.rig.headWorld(_v2);
    const sirens = this.police.sirenUnits(_v2).slice(0, 2).map((u) => new THREE.Vector3(u.car.x, 1.4, u.car.z));
    this.audio.updateSirens(sirens);
    this.audio.updateAmbience(dt, _v2);
  }

  // =====================================================================
  // Missions / money / busted
  // =====================================================================

  private runMissionAction(a: ActionDef, _m: MissionDef): void {
    switch (a.action) {
      case 'spawn_item':
        this.missionWorld.spawnItem(a.item);
        break;
      case 'despawn_item':
        this.missionWorld.despawnItem(a.item);
        break;
      case 'set_wanted': {
        const z = a.zone ? ZONES.find((zz) => zz.id === a.zone) : null;
        this.player.position(_v);
        this.crimes.commit('alarm', z ? z.x : _v.x, z ? z.z : _v.z);
        if (this.wanted.level < a.level) this.wanted.force(a.level, z ? z.x : _v.x, z ? z.z : _v.z);
        this.audio.play('alarm', _v.set(z ? z.x : _v.x, 2, z ? z.z : _v.z));
        break;
      }
      case 'toast':
        this.toast(a.text, a.kind ?? 'info');
        break;
      case 'show_checkpoints':
        this.missionWorld.showCheckpoints(a.ids);
        break;
      case 'hide_checkpoints':
        this.missionWorld.showCheckpoints(null);
        break;
    }
  }

  addMoney(n: number): void {
    this.money = Math.max(0, this.money + n);
    this.bus.emit('money:changed', { money: this.money, delta: n });
  }

  restartMission(): void {
    this.wanted.clear();
    this.crimes.clearPending();
    this.police.resetAll();
    this.missionWorld.resetAll();
    if (this.missions.restart()) this.toast('미션을 처음부터 다시 시작합니다', 'info');
  }

  abandonMission(): void {
    if (!this.missions.activeDef) return;
    this.missions.abandon();
  }

  private async busted(): Promise<void> {
    if (this.player.busy) return;
    const fine = Math.min(this.money, Math.max(50, Math.round(this.money * 0.1)));
    this.addMoney(-fine);
    this.audio.play('busted');
    this.toast(`체포되었습니다! 벌금 -$${fine}`, 'bad', 5);
    this.bus.emit('player:busted', { fine });
    this.missions.handle({ type: 'busted' });
    this.wanted.clear();
    this.crimes.clearPending();
    this.police.resetAll();
    const s = SPAWNS.precinct;
    await this.player.warpTo(s.x, s.z, s.yaw);
    this.requestAutosave();
  }

  // =====================================================================
  // Save / load / settings
  // =====================================================================

  private buildSave(): SaveData {
    return {
      version: 1,
      savedAt: Date.now(),
      player: { position: [this.lastSafe.x, 0, this.lastSafe.z], yaw: this.player.driving ? this.vehicle.physics.yaw() : this.rig.headYaw() },
      money: this.money,
      completedMissions: [...this.missions.completed],
      activeMission: this.missions.snapshot(),
      settings: this.settings,
    };
  }

  doSave(reason: string): boolean {
    if (this.wanted.level > 0) {
      this.toast('수배 중에는 저장할 수 없습니다', 'warn');
      return false;
    }
    const ok = this.save.save(this.buildSave());
    const time = new Date().toLocaleTimeString();
    this.lastSaveInfo = ok ? `${time} 저장됨 (${reason})` : `${time} 저장 실패: 브라우저 저장소를 사용할 수 없음`;
    if (ok && !reason.includes('자동')) this.toast('저장 완료', 'good', 2);
    return ok;
  }

  private requestAutosave(): void {
    this.autosaveTimer = Math.min(this.autosaveTimer, 1.5);
  }

  private updateAutosave(dt: number): void {
    this.autosaveTimer -= dt;
    if (this.autosaveTimer <= 0) {
      this.autosaveTimer = 60;
      if (this.wanted.level === 0 && !this.player.busy) this.doSave('자동 저장');
    }
    if (this.settingsSaveTimer > 0) {
      this.settingsSaveTimer -= dt;
      if (this.settingsSaveTimer <= 0) this.requestAutosave();
    }
  }

  /** Applies save data to the running world (start / load). */
  private applySave(data: SaveData, initial: boolean): void {
    this.settings = sanitizeSettings(data.settings);
    this.money = data.money;
    this.missions.active = null;
    this.missionWorld.resetAll();
    this.missions.restoreCompleted(data.completedMissions);
    this.wanted.clear();
    this.crimes.clearPending();
    this.police.resetAll();
    let [x, , z] = data.player.position;
    if (this.staticWorld.isCircleBlocked(x, z, 0.35)) {
      x = SPAWNS.plaza.x;
      z = SPAWNS.plaza.z;
    }
    this.lastSafe.set(x, 0, z);
    const finish = (): void => {
      if (data.activeMission) {
        if (this.missions.resume(data.activeMission.id, data.activeMission.objectiveIndex)) this.toast('진행 중이던 미션을 체크포인트부터 이어갑니다', 'info', 4);
      }
    };
    if (initial) {
      this.rig.spawnAt(x, z, 0, data.player.yaw);
      this.locomotion.warp(x, z);
      finish();
    } else {
      void this.player.warpTo(x, z, data.player.yaw).then(finish);
    }
    this.applySettings();
  }

  loadFromSave(): void {
    const r = this.save.load();
    this.applySave(r.data, false);
    this.lastSaveInfo = `불러오기 상태: ${r.status}${r.notes.length ? ' (' + r.notes.join(', ') + ')' : ''}`;
    this.toast(r.status === 'ok' ? '불러오기 완료' : `불러오기: ${r.status}`, r.status === 'ok' ? 'good' : 'warn', 4);
  }

  changeSettings(fn: (s: Settings) => void): void {
    const prevHand = this.settings.comfort.dominantHand;
    fn(this.settings);
    this.settings = sanitizeSettings(this.settings);
    this.applySettings();
    if (prevHand !== this.settings.comfort.dominantHand) this.onXRHandsChanged();
    this.settingsSaveTimer = 2;
  }

  private applySettings(): void {
    const s = this.settings;
    this.overlay.level = s.comfort.vignette;
    this.rig.setHeightOffset(s.comfort.heightOffset);
    this.audio.applySettings(s.audio);
    this.env.setQuality(s.graphics.quality, this.renderer);
    this.vehicle.wheelGrab.enabled = s.comfort.wheelGrabSteering && !!this.player?.driving;
  }

  private runMenuAction(a: MenuAction): void {
    switch (a) {
      case 'restart_mission':
        this.restartMission();
        break;
      case 'abandon_mission':
        this.abandonMission();
        break;
      case 'call_car':
        this.callCar();
        break;
      case 'save':
        this.doSave('메뉴에서 저장');
        break;
      case 'load':
        this.loadFromSave();
        break;
      case 'reset_save':
        this.save.clear();
        this.applySave(defaultSaveData(), false);
        this.lastSaveInfo = '저장 데이터 초기화됨';
        this.toast('저장 데이터를 초기화했습니다', 'warn');
        break;
      case 'corrupt_save':
        this.save.corruptForTesting();
        this.lastSaveInfo = '저장 파일을 일부러 손상시켰습니다. "불러오기"로 복구 동작을 확인하세요.';
        this.toast('저장 파일 손상 (QA 테스트)', 'warn');
        break;
      case 'toggle_debug':
        this.debug.toggle();
        break;
      case 'calibrate_height':
        this.calibrateHeight();
        break;
      case 'recenter':
        if (this.player.driving) this.player.recenter();
        else this.rig.resetDesktopPitch();
        break;
      case 'respawn': {
        const s = this.wanted.level > 0 ? null : SPAWNS.plaza;
        if (!s) {
          this.toast('수배 중에는 이동할 수 없습니다', 'warn');
          break;
        }
        void this.player.warpTo(s.x, s.z, s.yaw);
        break;
      }
      case 'recover_car':
        void this.player.recoverVehicle();
        break;
    }
  }

  /** Seated / short players: raise the virtual eye height to the standard standing height. */
  calibrateHeight(): void {
    if (!this.isXR) {
      this.toast('키 보정은 VR에서 사용합니다', 'info');
      return;
    }
    const tracked = this.rig.trackedHeadHeight();
    this.changeSettings((s) => (s.comfort.heightOffset = Math.round((tuning.player.calibratedEyeHeight - tracked) * 100) / 100));
    this.toast(`키 보정 완료 (${this.settings.comfort.heightOffset >= 0 ? '+' : ''}${this.settings.comfort.heightOffset.toFixed(2)}m)`, 'good');
  }

  /** Brings the car to the nearest road near the player (when lost / far away). */
  callCar(): void {
    if (this.player.driving) {
      void this.player.recoverVehicle();
      return;
    }
    this.player.position(_v);
    this.movers.carObbs(this.vehicle.id, this.carObbs);
    this.vehicle.recover(this.carObbs, _v);
    this.toast('가까운 도로에 차량을 불렀습니다', 'info');
  }

  toast(text: string, kind: ToastKind = 'info', duration?: number): void {
    this.notifier.push(text, kind, duration);
  }

  private onResize(): void {
    if (this.isXR) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
