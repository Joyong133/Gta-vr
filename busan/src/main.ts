/**
 * 부산 VR (Meta Quest 3 · WebXR) — 진입점.
 * 주소 뒤에 ?region=<지역id> 를 붙이면 그 지역을 연다(기본: 첫 번째 지역).
 */
import * as THREE from 'three';
import { ControllerState } from '../../src/input/ControllerState';
import { Hud } from './Hud';
import { type Controls, emptyControls, Player } from './Player';
import { listRegions } from './regions';
import { World } from './World';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 없음`);
  return el;
};

const regions = listRegions();
const params = new URLSearchParams(location.search);
const region = regions.find((r) => r.id === params.get('region')) ?? regions[0];

// ---------------------------------------------------------------- 렌더러/씬
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.15, 60000);
const world = new World(scene);
const player = new Player(camera, world.ground, world.spawns);
player.attach(scene);
const hud = new Hud(camera);
player.onMessage = (t) => hud.toast(t);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- XR 컨트롤러
const hands = { left: new ControllerState('left'), right: new ControllerState('right') };
const rays: Record<'left' | 'right', THREE.Object3D | null> = { left: null, right: null };
const handMat = new THREE.MeshLambertMaterial({ color: 0x2b3448 });
for (let i = 0; i < 2; i++) {
  const ray = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.09, 4, 8).rotateX(Math.PI / 2 - 0.5), handMat);
  grip.add(body);
  player.rig.add(ray, grip);
  ray.addEventListener('connected', (e) => {
    const hand = (e as unknown as { data: XRInputSource }).data.handedness;
    if (hand === 'left' || hand === 'right') rays[hand] = ray;
    if (hand === 'left') hud.attachToHand(grip);
  });
  ray.addEventListener('disconnected', () => {
    if (rays.left === ray) rays.left = null;
    if (rays.right === ray) rays.right = null;
  });
}

const dead = (v: number, d = 0.15): number => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
let snapArmed = true;
let aiming = false;

function xrControls(c: Controls): void {
  const session = renderer.xr.getSession();
  let lg: Gamepad | null = null;
  let rg: Gamepad | null = null;
  if (session) {
    for (const src of session.inputSources) {
      if (src.handedness === 'left') lg = src.gamepad ?? null;
      if (src.handedness === 'right') rg = src.gamepad ?? null;
    }
  }
  hands.left.update(lg);
  hands.right.update(rg);
  const L = hands.left;
  const R = hands.right;
  c.moveX = dead(L.stickX);
  c.moveY = -dead(L.stickY);
  c.boost = L.squeeze.pressed;
  if (snapArmed && Math.abs(R.stickX) > 0.7 && Math.abs(R.stickX) > Math.abs(R.stickY)) {
    c.snap = Math.sign(R.stickX);
    snapArmed = false;
  } else if (Math.abs(R.stickX) < 0.3) snapArmed = true;
  if (player.mode === 'walk') {
    if (!aiming && R.stickY < -0.6 && Math.abs(R.stickX) < 0.5) aiming = true;
    else if (aiming && R.stickY > -0.3) aiming = false;
    c.teleportAim = aiming;
  } else {
    aiming = false;
    c.vertical = Math.abs(R.stickX) < 0.5 ? -dead(R.stickY) : 0;
  }
  c.toggleFly = R.primary.down;
  c.toggleGiant = R.secondary.down;
  c.spawnStep = L.primary.down ? -1 : L.secondary.down ? 1 : 0;
  if (c.snap || c.toggleFly || c.toggleGiant || c.spawnStep) R.pulse(0.3, 30);
}

// ---------------------------------------------------------------- 데스크톱 입력
const keys = new Set<string>();
const pressed = new Set<string>();
let mouseDX = 0;
let mouseDY = 0;
window.addEventListener('keydown', (e) => {
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.domElement) {
    mouseDX += e.movementX;
    mouseDY += e.movementY;
  }
});
renderer.domElement.addEventListener('click', () => {
  if (started && !renderer.xr.isPresenting) void renderer.domElement.requestPointerLock();
});

const desktopRay = new THREE.Object3D();
camera.add(desktopRay);
desktopRay.position.set(0.15, -0.2, 0);

function desktopControls(c: Controls): void {
  const k = (code: string): number => (keys.has(code) ? 1 : 0);
  c.moveY = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown');
  c.moveX = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft');
  c.vertical = k('Space') - k('KeyC');
  c.boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
  c.yawDelta = mouseDX * 0.0022;
  c.pitchDelta = mouseDY * 0.0022;
  mouseDX = mouseDY = 0;
  c.teleportAim = keys.has('KeyT');
  c.toggleFly = pressed.has('KeyF');
  c.toggleGiant = pressed.has('KeyG');
  c.spawnStep = pressed.has('BracketLeft') ? -1 : pressed.has('BracketRight') ? 1 : 0;
  for (let d = 0; d <= 9; d++) if (pressed.has(`Digit${d}`)) c.spawnIndex = d === 0 ? 9 : d - 1;
  pressed.clear();
}

// ---------------------------------------------------------------- 루프
let lastTime = performance.now();
let elapsed = 0;
const camPos = new THREE.Vector3();
let started = false;
let frameCount = 0;
let fps = 0;
let fpsAcc = 0;
let fpsN = 0;
let lastControls = emptyControls();

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  elapsed += dt;
  const t = elapsed;
  frameCount++;
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc >= 1) {
    fps = Math.round(fpsN / fpsAcc);
    fpsAcc = 0;
    fpsN = 0;
  }
  const xr = renderer.xr.isPresenting;
  if (started) {
    const c = emptyControls();
    if (xr) xrControls(c);
    else desktopControls(c);
    lastControls = c;
    player.update(dt, c, xr, xr ? rays.right : desktopRay);
  }
  camera.getWorldPosition(camPos);
  const alt = started ? player.altitude() : 0;
  world.update(dt, t, camPos, Math.max(alt, 0));
  if (started) {
    const s = world.spawns[player.spawnIndex];
    hud.update(
      dt,
      {
        region: region?.name ?? '',
        mode: `${player.giant ? '거인 · ' : ''}${player.mode === 'fly' ? '비행' : '걷기'}`,
        place: s ? s.name : '',
        altitude: alt,
        fps,
      },
      xr,
    );
  }
  renderer.render(scene, camera);
});

// ---------------------------------------------------------------- 타이틀/시작
const status = $('status');
const bar = $('bar');
const btnVR = $('btn-vr') as HTMLButtonElement;
const btnDesk = $('btn-desktop') as HTMLButtonElement;
let loaded = false;
let xrSupported = false;

function renderRegionList(): void {
  const list = $('regions');
  list.innerHTML = '';
  for (const r of regions) {
    const a = document.createElement('a');
    a.className = `region${r.id === region?.id ? ' active' : ''}`;
    a.href = `?region=${encodeURIComponent(r.id)}`;
    a.innerHTML = `<b>${r.name}</b><span>${r.subtitle}</span><small>건물 ${(r.stats.buildings ?? 0).toLocaleString()}동 · 장소 ${r.spawns.length}곳</small>`;
    list.appendChild(a);
  }
  if (region) $('attribution').textContent = region.attribution;
}

function updateButtons(): void {
  btnDesk.disabled = !loaded;
  btnVR.disabled = !loaded || !xrSupported;
  btnVR.textContent = xrSupported ? 'VR로 들어가기' : 'VR 미지원 브라우저';
}

async function checkXR(): Promise<void> {
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  xrSupported = !!xr && (await xr.isSessionSupported('immersive-vr').catch(() => false));
  updateButtons();
}

function begin(): void {
  if (!started) {
    started = true;
    player.warp(0);
  }
  $('title').classList.add('hidden');
}

async function enterXR(): Promise<void> {
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr) throw new Error('WebXR 없음');
  const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
  await renderer.xr.setSession(session);
  renderer.xr.setFoveation(0.6);
  begin();
  // 머리 위치가 잡힌 뒤 현재 장소에 다시 맞춘다
  setTimeout(() => player.warp(player.spawnIndex), 300);
  session.addEventListener('end', () => {
    $('title').classList.remove('hidden');
    status.textContent = 'VR이 끝났습니다. 다시 들어가거나 데스크톱으로 볼 수 있어요.';
  });
}

btnVR.addEventListener('click', () => {
  enterXR().catch((e: Error) => (status.textContent = `VR 시작 실패: ${e.message}`));
});
btnDesk.addEventListener('click', () => {
  begin();
  void renderer.domElement.requestPointerLock();
});

/** 테스트용: Meta IWER 가상 Quest 3 */
async function installEmulator(): Promise<unknown> {
  const { XRDevice, metaQuest3 } = await import('iwer');
  const device = new XRDevice(metaQuest3, { stereoEnabled: false });
  device.installRuntime({ forceInstall: true });
  device.position.set(0, 1.6, 0);
  await checkXR();
  return device;
}

(window as unknown as { busan: unknown }).busan = {
  THREE,
  renderer,
  scene,
  camera,
  world,
  player,
  hands,
  installEmulator,
  enterXR,
  begin,
  get loaded() {
    return loaded;
  },
  get frameCount() {
    return frameCount;
  },
  get controls() {
    return lastControls;
  },
  state() {
    const f = player.feet();
    const info = renderer.info.render;
    return { ...f, mode: player.mode, giant: player.giant, spawn: player.spawnIndex, altitude: player.altitude(), xr: renderer.xr.isPresenting, triangles: info.triangles, calls: info.calls, ...world.stats() };
  },
};

renderRegionList();
void checkXR();
if (!region) {
  status.textContent = '등록된 지역이 없습니다 (busan/regions/<지역>/region.json).';
} else {
  world
    .load(region, (f, label) => {
      bar.style.width = `${Math.round(f * 100)}%`;
      status.textContent = label;
    })
    .then(() => {
      loaded = true;
      player.warp(0);
      status.textContent = `${region.name} 준비 완료 — 삼각형 ${(region.stats.terrain_tris + region.stats.city_tris + region.stats.roads_tris).toLocaleString()}개`;
      updateButtons();
    })
    .catch((e: Error) => {
      status.textContent = `불러오기 실패: ${e.message}`;
      console.error(e);
    });
}
updateButtons();
