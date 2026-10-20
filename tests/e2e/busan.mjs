/**
 * 부산 VR(/busan/) 테스트: 헤드리스 Chromium + IWER(가상 Quest 3).
 *
 *   npm run build && npm run smoke:busan
 *
 * 지역 로딩, 장소 이동(옥상 착지 포함), 데스크톱 이동/건물 충돌, XR 세션과 컨트롤러 입력
 * (이동·스냅 회전·텔레포트·비행·거인 모드·장소 버튼)을 확인하고 스크린샷을 남긴다.
 * 마지막으로 GitHub Pages "Deploy from a branch"(저장소 파일을 빌드 없이 그대로 서비스)를 흉내 내
 * /busan/ 과 / 가 미리 빌드된 busan/play/ 로 넘어가 로딩을 끝내는지 확인한다.
 * 실제 헤드셋의 프레임레이트/편안함을 대신하지는 않는다.
 */
import { createReadStream, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright-core';

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 4192;

/** GitHub Pages 브랜치 배포처럼 저장소 파일을 /Gta-vr/ 아래에 그대로 내보낸다(.ts는 video/mp2t). */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.ts': 'video/mp2t', '.json': 'application/json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const REPO = new URL('../../', import.meta.url).pathname;
const pages = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith('/Gta-vr/')) return res.writeHead(404).end();
  let file = normalize(join(REPO, path.slice('/Gta-vr/'.length)));
  if (!file.startsWith(REPO)) return res.writeHead(403).end();
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    statSync(file);
  } catch {
    return res.writeHead(404).end();
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(4193, '127.0.0.1');

const server = await preview({ preview: { port: PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

let failures = 0;
let passes = 0;
function check(name, cond, detail = '') {
  if (cond) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}
const ev = (fn, arg) => page.evaluate(fn, arg);
const state = () => ev(() => window.busan.state());
async function frames(n) {
  const start = await ev(() => window.busan.frameCount);
  await page.waitForFunction((t) => window.busan.frameCount >= t, start + n, { timeout: 180000 });
}
const button = (hand, id, value) => ev(([h, i, v]) => window.busan.xrDevice.controllers[h].updateButtonValue(i, v), [hand, id, value]);
const stick = (hand, x, y) => ev(([h, xx, yy]) => window.busan.xrDevice.controllers[h].updateAxes('thumbstick', xx, yy), [hand, x, y]);
async function tap(hand, id) {
  await button(hand, id, 1);
  await frames(3);
  await button(hand, id, 0);
  await frames(3);
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

try {
  await page.goto(`http://127.0.0.1:${PORT}/busan/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.busan && window.busan.loaded, null, { timeout: 180000 });

  console.log('A. 로딩');
  const info = await ev(() => ({ regions: window.busan.world.regions.map((r) => r.id), spawns: window.busan.world.spawns.length, tiles: window.busan.world.tiles.length }));
  check('해운대 지역 로드', info.regions.includes('haeundae'), JSON.stringify(info));
  check('장소 10곳', info.spawns === 10, String(info.spawns));
  check('타일 300개 이상(건물·도로·나무)', info.tiles > 300, String(info.tiles));
  await page.screenshot({ path: `${OUT}busan_title.png` });

  console.log('B. 데스크톱 · 장소');
  await ev(() => window.busan.begin());
  await frames(10);
  let s = await state();
  check('해운대해수욕장에서 시작(걷기)', s.mode === 'walk' && s.spawn === 0, JSON.stringify(s));
  check('해변 지면 높이 0~5m', s.z >= 0 && s.z < 5, String(s.z));
  await page.screenshot({ path: `${OUT}busan_beach.png` });
  const shots = { 1: 'lct_roof', 4: 'gwangan_fly', 9: 'jangsan' };
  for (const [i, name] of Object.entries(shots)) {
    await ev((k) => window.busan.player.warp(k), Number(i));
    await frames(12);
    s = await state();
    if (name === 'lct_roof') check('엘시티 옥상 착지(400m 이상)', s.z > 400 && s.z < 430, String(s.z));
    if (name === 'gwangan_fly') check('광안대교 상공은 비행 모드', s.mode === 'fly' && s.z > 60, JSON.stringify(s));
    if (name === 'jangsan') check('장산 정상 600m 이상', s.z > 600, String(s.z));
    await page.screenshot({ path: `${OUT}busan_${name}.png` });
    console.log(`    (${name}) 드로우콜 ${s.calls}, 삼각형 ${s.triangles.toLocaleString()}`);
  }
  const perf = await state();
  console.log(`    (장산 시점) 드로우콜 ${perf.calls}, 삼각형 ${perf.triangles.toLocaleString()}, 보이는 타일 ${perf.visible}/${perf.tiles}`);

  console.log('C. 데스크톱 이동 · 충돌');
  await ev(() => window.busan.player.warp(0));
  await frames(5);
  const a = await state();
  await page.keyboard.down('KeyW');
  await frames(30);
  await page.keyboard.up('KeyW');
  const b = await state();
  check('W로 앞으로 걷기', dist(a, b) > 0.5, `${dist(a, b)}`);
  // 건물 벽을 향해 계속 걸으면 막혀야 한다: 가장 가까운 건물 중심을 향해 배치
  const blocked = await ev(() => {
    const B = window.busan;
    const fp = B.world.ground.parts[0].buildings;
    const p = B.player.feet();
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < fp.count; i++) {
      if (fp.zt[i] - fp.zb[i] < 15) continue;
      const k = fp.start[i];
      const d = Math.hypot(fp.xy[k * 2] - p.x, fp.xy[k * 2 + 1] - p.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    let cx = 0;
    let cy = 0;
    const n = fp.n[best];
    for (let j = 0; j < n; j++) {
      cx += fp.xy[(fp.start[best] + j) * 2] / n;
      cy += fp.xy[(fp.start[best] + j) * 2 + 1] / n;
    }
    const k = fp.start[best];
    const vx = fp.xy[k * 2];
    const vy = fp.xy[k * 2 + 1];
    // 꼭짓점에서 바깥으로 15m 떨어진 곳에서 중심을 바라보고 선다
    const ox = vx + ((vx - cx) / Math.hypot(vx - cx, vy - cy)) * 15;
    const oy = vy + ((vy - cy) / Math.hypot(vx - cx, vy - cy)) * 15;
    const ground = B.world.ground.terrain(ox, oy);
    const yaw = (Math.atan2(cx - ox, cy - oy) * 180) / Math.PI;
    B.player.placeAt(ox, oy, ground, yaw);
    return { inside: B.world.ground.blocked(cx, cy, ground) };
  });
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await frames(90);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const c = await state();
  const inWall = await ev((p) => window.busan.world.ground.blocked(p.x, p.y, p.z), c);
  check('건물 벽에 막힘(안으로 못 들어감)', blocked.inside && !inWall, JSON.stringify({ blocked, c }));
  await page.keyboard.press('KeyF');
  await frames(3);
  await page.keyboard.down('Space');
  await frames(40);
  await page.keyboard.up('Space');
  const d = await state();
  check('F 비행 + Space 상승', d.mode === 'fly' && d.z > c.z + 5, JSON.stringify({ c: c.z, d: d.z }));
  await page.keyboard.press('KeyG');
  await frames(5);
  check('G 거인 모드', (await state()).giant === true);
  await page.screenshot({ path: `${OUT}busan_giant.png` });
  await page.keyboard.press('KeyG');
  await frames(3);

  console.log('D. XR (IWER 가상 Quest 3)');
  await ev(async () => {
    window.busan.xrDevice = await window.busan.installEmulator();
  });
  await ev(() => window.busan.enterXR());
  await page.waitForFunction(() => window.busan.state().xr, null, { timeout: 60000 });
  await frames(30);
  s = await state();
  check('immersive-vr 세션', s.xr === true);
  const before = await state();
  await stick('left', 0, -1);
  await frames(40);
  await stick('left', 0, 0);
  const after = await state();
  check('왼스틱 이동', dist(before, after) > 1, `${dist(before, after)}`);
  const yaw0 = await ev(() => window.busan.player.rig.rotation.y);
  await stick('right', 1, 0);
  await frames(3);
  await stick('right', 0, 0);
  await frames(3);
  const yaw1 = await ev(() => window.busan.player.rig.rotation.y);
  check('오른스틱 45° 스냅 회전', Math.abs(Math.abs(yaw1 - yaw0) - Math.PI / 4) < 0.01, `${yaw1 - yaw0}`);
  // 텔레포트: 오른손을 앞쪽 아래로 향하게 하고 스틱을 밀었다 놓는다
  await ev(() => {
    const c = window.busan.xrDevice.controllers.right;
    c.position.set(0.2, 1.2, -0.3);
    c.quaternion.setFromEuler?.(0, 0, 0);
  });
  const t0 = await state();
  await stick('right', 0, -1);
  await frames(10);
  const aim = await ev(() => window.busan.controls.teleportAim);
  await stick('right', 0, 0);
  await frames(10);
  const t1 = await state();
  check('텔레포트 조준 → 이동', aim && dist(t0, t1) > 2, JSON.stringify({ aim, d: dist(t0, t1) }));
  await tap('right', 'a-button');
  check('A 비행 모드', (await state()).mode === 'fly');
  const f0 = await state();
  await stick('right', 0, -1);
  await frames(30);
  await stick('right', 0, 0);
  const f1 = await state();
  check('비행 중 오른스틱 ↑ 상승', f1.z > f0.z + 3, JSON.stringify({ f0: f0.z, f1: f1.z }));
  await tap('right', 'b-button');
  check('B 거인 모드', (await state()).giant === true);
  await tap('right', 'b-button');
  await tap('left', 'y-button');
  const y = await state();
  check('Y 다음 장소', y.spawn === 1, String(y.spawn));
  await tap('left', 'x-button');
  check('X 이전 장소', (await state()).spawn === 0);
  await frames(10);
  await page.screenshot({ path: `${OUT}busan_xr.png` });

  check('페이지 오류 없음', errors.length === 0, errors.join('\n'));

  console.log('E. GitHub Pages 브랜치 배포(빌드 없음) 모드');
  for (const [path, label] of [['/Gta-vr/busan/', '/busan/'], ['/Gta-vr/', '/ (루트)']]) {
    const p2 = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await p2.goto(`http://127.0.0.1:4193${path}`, { waitUntil: 'load' });
    const ok = await p2
      .waitForFunction(() => window.busan && window.busan.loaded, null, { timeout: 120000 })
      .then(() => true)
      .catch(() => false);
    const where = new URL(p2.url()).pathname;
    const status = await p2.evaluate(() => document.getElementById('status')?.textContent ?? '');
    check(`${label} → busan/play/ 로 넘어가 로딩 완료`, ok && where === '/Gta-vr/busan/play/', JSON.stringify({ where, status }));
    await p2.close();
  }
} catch (e) {
  failures++;
  console.log('  ✗ 예외', e);
  console.log(errors.join('\n'));
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
  pages.close();
}
console.log(`\n${passes} 통과, ${failures} 실패`);
process.exit(failures ? 1 : 0);
