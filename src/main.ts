import * as THREE from 'three';
import { Game } from './game/Game';
import { tuning } from './config/tuning';
import { SPAWNS } from './world/CityLayout';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const app = $('app');
const status = $('titleStatus');
const btnVR = $<HTMLButtonElement>('btnVR');
const btnDesktop = $<HTMLButtonElement>('btnDesktop');
const btnEmu = $<HTMLButtonElement>('btnEmu');
const vrHint = $('vrHint');

let game: Game;
try {
  game = new Game(app);
} catch (err) {
  status.textContent = `초기화 실패: ${(err as Error).message} (WebGL2 지원 브라우저가 필요합니다)`;
  throw err;
}

const params = new URLSearchParams(location.search);

function opts(): { newGame: boolean; seated: boolean; leftHanded: boolean } {
  return {
    newGame: ($<HTMLInputElement>('optNew')).checked || params.has('new'),
    seated: ($<HTMLInputElement>('optSeated')).checked,
    leftHanded: ($<HTMLInputElement>('optLeft')).checked,
  };
}

function hideTitle(): void {
  $('title').classList.add('hidden');
}

async function checkXR(): Promise<boolean> {
  try {
    return !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr'));
  } catch {
    return false;
  }
}

async function startXR(): Promise<void> {
  status.textContent = 'VR 세션 시작 중…';
  game.start('xr', opts());
  try {
    await game.enterXR();
    hideTitle();
  } catch (err) {
    status.textContent = `VR 시작 실패: ${(err as Error).message}`;
  }
}

// Touch-only devices: no on-screen controls in v1.
if (window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(pointer: fine)').matches) {
  status.textContent = '터치 조작은 지원하지 않습니다. PC 브라우저(키보드·마우스) 또는 VR 헤드셋 브라우저에서 플레이하세요.';
}

void checkXR().then((ok) => {
  btnVR.disabled = !ok;
  vrHint.textContent = ok
    ? '헤드셋 연결됨 — 서서 플레이 권장, 앉은 자세는 옵션 선택'
    : window.isSecureContext
      ? '이 브라우저/기기에서 immersive-vr 미지원 (Quest 브라우저 또는 PC VR + Chrome/Edge)'
      : 'HTTPS(또는 localhost)에서만 WebXR을 사용할 수 있습니다';
});

btnVR.addEventListener('click', () => void startXR());

btnDesktop.addEventListener('click', () => {
  game.start('desktop', opts());
  hideTitle();
});

btnEmu.addEventListener('click', async () => {
  status.textContent = 'IWER 에뮬레이터 로드 중…';
  try {
    const device = await installEmulator();
    (window as unknown as { neon: Record<string, unknown> }).neon.xrDevice = device;
    btnVR.disabled = false;
    await startXR();
  } catch (err) {
    status.textContent = `에뮬레이터 실패: ${(err as Error).message}`;
  }
});

/** Meta's Immersive Web Emulation Runtime: a scripted WebXR device (no headset). */
async function installEmulator(): Promise<unknown> {
  const { XRDevice, metaQuest3 } = await import('iwer');
  const device = new XRDevice(metaQuest3, { stereoEnabled: false });
  device.installRuntime({ forceInstall: true });
  device.position.set(0, 1.6, 0);
  return device;
}

// Clicking the canvas (desktop) captures the mouse.
app.addEventListener('click', () => {
  if (!game.isXR && $('title').classList.contains('hidden')) game.desktopInput.requestPointerLock();
});

// ---------------------------------------------------------------------------
// window.neon: debug / QA / automated-test API (also handy in the console).
// ---------------------------------------------------------------------------
const v = new THREE.Vector3();
const api = {
  game,
  THREE,
  start: (mode: 'desktop' | 'xr' = 'desktop', newGame = false) => {
    const r = game.start(mode, { newGame, seated: false, leftHanded: false });
    hideTitle();
    return r.status;
  },
  installEmulator,
  enterXR: () => game.enterXR(),
  state: () => {
    const p = game.player.position(v);
    return {
      frame: game.frameCount,
      xr: game.isXR,
      mode: game.player.mode,
      busy: game.player.busy,
      pos: [+p.x.toFixed(2), +p.z.toFixed(2)],
      head: (() => {
        const h = game.rig.headWorld(new THREE.Vector3());
        return [+h.x.toFixed(2), +h.y.toFixed(2), +h.z.toFixed(2)];
      })(),
      money: game.money,
      wanted: game.wanted.level,
      searching: game.wanted.searching,
      mission: game.missions.activeDef?.id ?? null,
      objective: game.missions.currentObjective?.id ?? null,
      completed: [...game.missions.completed],
      carSpeed: +game.vehicle.speed.toFixed(2),
      carUp: +game.vehicle.physics.upY().toFixed(2),
      flipped: game.vehicle.physics.isFlipped,
      stuck: game.vehicle.physics.isStuck,
      police: game.police.units.map((u) => `${u.id}:${u.state}${u.sees ? '*' : ''}`),
      peds: game.peds.stateCounts(),
      held: game.interaction.hands.map((h) => h.held?.id ?? null),
      hover: game.interaction.hands.map((h) => h.hover?.id ?? null),
      drawCalls: game.renderer.info.render.calls,
      fps: +game.perf.fps.toFixed(1),
    };
  },
  teleport: (x: number, z: number, yaw = 0) => game.player.warpTo(x, z, yaw, true),
  enterCar: () => game.player.enterVehicle(),
  exitCar: () => game.player.exitVehicle(true),
  placeCar: (x: number, z: number, yaw = 0) => game.vehicle.spawn(x, z, yaw),
  flipCar: () => {
    const b = game.vehicle.body;
    b.position.y += 1.2;
    b.quaternion.setFromEuler(0, game.vehicle.physics.yaw(), Math.PI * 0.95);
    b.angularVelocity.setZero();
  },
  recoverCar: () => game.player.recoverVehicle(),
  setWanted: (level: number) => {
    const p = game.player.position(v);
    game.wanted.force(level, p.x, p.z);
  },
  acceptMission: () => {
    const m = game.missions.nextAvailable('mika');
    return m ? game.missions.start(m.id, game.wanted.level) : false;
  },
  /** Desktop hand grabs a registered grabbable by id (bypasses aiming). */
  grab: (id: string) => game.debugGrab(id),
  /** Teleports next to the driver's door, facing the car. */
  gotoCar: () => {
    const p = game.driverDoorSpot();
    const c = game.vehicle.worldPosition(new THREE.Vector3());
    return game.player.warpTo(p.x, p.z, Math.atan2(-(c.x - p.x), -(c.z - p.z)), true);
  },
  dropInto: (itemId: string, socketId: string) => {
    const item = game.missionWorld.items.get(itemId);
    const socket = game.interaction.sockets.find((s) => s.id === socketId);
    if (!item || !socket) return false;
    for (const h of game.interaction.hands) if (h.held === item) game.interaction.releaseHand(h, true);
    socket.insert(item);
    return true;
  },
  key: (code: string, down: boolean) => game.desktopInput.simulateKey(code, down),
  save: () => game.doSave('테스트 저장'),
  load: () => game.loadFromSave(),
  corruptSave: () => game.save.corruptForTesting(),
  clearSave: () => game.save.clear(),
  setSetting: (path: string, value: unknown) =>
    game.changeSettings((s) => {
      const [a, b] = path.split('.');
      (s as unknown as Record<string, Record<string, unknown>>)[a][b] = value;
    }),
  spawns: SPAWNS,
  tuning,
  /** Desktop: aim the view at a world point (yaw on the rig, pitch on the camera). */
  lookAt: (x: number, y: number, z: number) => {
    const h = game.rig.headWorld(new THREE.Vector3());
    const yaw = Math.atan2(-(x - h.x), -(z - h.z));
    game.rig.rotateAroundHead(yaw - game.rig.headYaw());
    game.rig.resetDesktopPitch();
    const pitch = Math.atan2(y - h.y, Math.hypot(x - h.x, z - h.z));
    game.rig.applyDesktopLook(0, -pitch);
  },
  /** Brings the car to the nearest free road spot near (x, z). */
  callCarTo: (x: number, z: number) => {
    game.vehicle.recover(game.movers.carObbs(game.vehicle.id), new THREE.Vector3(x, 0, z));
  },
  errors: [] as string[],
};
(window as unknown as { neon: typeof api & Record<string, unknown> }).neon = api;

if (params.has('autostart')) {
  api.start('desktop', params.has('new'));
}
