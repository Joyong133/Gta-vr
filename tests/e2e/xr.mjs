/**
 * WebXR code-path test using IWER (Immersive Web Emulation Runtime) in
 * headless Chromium: a scripted Quest 3 headset + Touch controllers.
 *
 *   npm run build && npm run smoke:xr
 *
 * Verifies session start, controller binding, stick locomotion, snap turn,
 * teleport, grip grab/release, wrist menu, entering the car with A, trigger
 * throttle and seated height calibration. This proves the XR input/logic path;
 * it is not a substitute for testing comfort/feel on a real headset.
 */
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
import { chromium } from 'playwright-core';

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 4191;

const server = await preview({ preview: { port: PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(`console: ${m.text()}`);
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
async function frames(n) {
  const start = await ev(() => window.neon.game.frameCount);
  await page.waitForFunction((t) => window.neon.game.frameCount >= t, start + n, { timeout: 120000 });
}
const idle = () => page.waitForFunction(() => !window.neon.game.player.busy, null, { timeout: 60000 });
/** Sets a controller button/axis on the emulated device. */
const button = (hand, id, value) => ev(([h, i, v]) => window.neon.xrDevice.controllers[h].updateButtonValue(i, v), [hand, id, value]);
const stick = (hand, x, y) => ev(([h, xx, yy]) => window.neon.xrDevice.controllers[h].updateAxes('thumbstick', xx, yy), [hand, x, y]);
/** Puts an emulated controller at a world position (converted into tracking space). */
const controllerAt = (hand, x, y, z) =>
  ev(([h, px, py, pz]) => {
    const g = window.neon.game;
    const local = g.rig.trackingSpace.worldToLocal(new window.neon.THREE.Vector3(px, py, pz));
    window.neon.xrDevice.controllers[h].position.set(local.x, local.y, local.z);
  }, [hand, x, y, z]);

try {
  await page.goto(`http://127.0.0.1:${PORT}/?new`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.neon && window.neon.game.frameCount > 2, null, { timeout: 120000 });

  console.log('A. XR session');
  await ev(async () => {
    window.neon.xrDevice = await window.neon.installEmulator();
  });
  await ev(() => window.neon.start('xr', true));
  await ev(() => window.neon.setSetting('graphics.quality', 'low'));
  await ev(() => window.neon.enterXR());
  await page.waitForFunction(() => window.neon.game.isXR, null, { timeout: 60000 });
  await frames(10);
  check('immersive-vr session running', await ev(() => window.neon.game.isXR));
  const hands = await ev(() => window.neon.game.xrHands.list().map((h) => h.id).sort());
  check('both controllers bound by handedness', JSON.stringify(hands) === '["left","right"]', JSON.stringify(hands));
  await page.screenshot({ path: `${OUT}xr_a_start.png` });

  console.log('B. locomotion');
  let s = await ev(() => window.neon.state());
  const p0 = s.pos;
  await stick('left', 0, -1);
  await frames(25);
  await stick('left', 0, 0);
  await frames(2);
  s = await ev(() => window.neon.state());
  check('left stick smooth locomotion', Math.hypot(s.pos[0] - p0[0], s.pos[1] - p0[1]) > 0.5, `${p0} -> ${s.pos}`);
  const y0 = await ev(() => window.neon.game.rig.rigYaw());
  await stick('right', 1, 0);
  await frames(3);
  await stick('right', 0, 0);
  await frames(3);
  const y1 = await ev(() => window.neon.game.rig.rigYaw());
  const dYaw = Math.abs(Math.atan2(Math.sin(y1 - y0), Math.cos(y1 - y0)));
  check('right stick snap turn (45°)', Math.abs(dYaw - Math.PI / 4) < 0.05, `${y0} -> ${y1}`);
  // Point the right controller down-forward and push the stick forward to aim a teleport.
  await ev(() => {
    const c = window.neon.xrDevice.controllers.right;
    c.position.set(0.2, 1.3, -0.3);
    c.quaternion.set(-0.2588, 0, 0, 0.9659); // pitched ~30° down
  });
  await frames(2);
  const before = (await ev(() => window.neon.state())).pos;
  await stick('right', 0, -1);
  await frames(5);
  const aimValid = await ev(() => window.neon.game.teleport.valid);
  await stick('right', 0, 0);
  await frames(2);
  await idle();
  await frames(3);
  s = await ev(() => window.neon.state());
  check('teleport arc valid', aimValid);
  check('teleport on stick release', Math.hypot(s.pos[0] - before[0], s.pos[1] - before[1]) > 1.5, `${before} -> ${s.pos}`);

  console.log('C. hands: grab, two hands, wrist menu');
  // Walk up to a trash can in the plaza and grab it with the right grip.
  await ev(() => window.neon.teleport(-36.5, -18, 0));
  await idle();
  await frames(3);
  const can = await ev(() => {
    const it = window.neon.game.interaction.interactables.find((i) => i.id.startsWith('trash') && Math.abs(i.object.position.x + 36.5) < 1);
    return it ? [it.id, it.object.position.x, it.object.position.y, it.object.position.z] : null;
  });
  check('found trash can near the plaza', !!can, JSON.stringify(can));
  if (can) {
    await controllerAt('right', can[1], can[2] + 0.1, can[3]);
    await frames(3);
    await button('right', 'squeeze', 1);
    await frames(3);
    let held = await ev(() => window.neon.state().held);
    check('right grip grabs the prop', held.includes(can[0]), JSON.stringify(held));
    // Second hand on it -> two-handed (midpoint) carry.
    await controllerAt('left', can[1] - 0.25, can[2] + 0.1, can[3]);
    await frames(3);
    await button('left', 'squeeze', 1);
    await frames(3);
    const two = await ev((id) => !!window.neon.game.interaction.interactables.find((i) => i.id === id).secondary, can[0]);
    check('left grip joins as second hand', two);
    await button('right', 'squeeze', 0);
    await frames(3);
    held = await ev(() => window.neon.state().held);
    check('releasing the first hand hands over to the second', held.includes(can[0]), JSON.stringify(held));
    await button('left', 'squeeze', 0);
    await frames(3);
    held = await ev(() => window.neon.state().held);
    check('releasing both drops it', !held.includes(can[0]), JSON.stringify(held));
  }
  await button('left', 'y-button', 1);
  await frames(2);
  await button('left', 'y-button', 0);
  await frames(2);
  check('Y opens the wrist menu', await ev(() => window.neon.game.menu.open && window.neon.game.menu.panel.mesh.visible));
  await page.screenshot({ path: `${OUT}xr_c_menu.png` });
  await button('left', 'y-button', 1);
  await frames(2);
  await button('left', 'y-button', 0);
  await frames(2);

  console.log('D. vehicle with controllers');
  await ev(() => window.neon.gotoCar());
  await idle();
  await frames(3);
  await button('right', 'a-button', 1);
  await frames(2);
  await button('right', 'a-button', 0);
  await page.waitForFunction(() => window.neon.game.player.mode === 'driving' && !window.neon.game.player.busy, null, { timeout: 60000 });
  check('A at the door enters the car', true);
  const head = await ev(() => {
    const g = window.neon.game;
    const h = g.rig.headWorld(new window.neon.THREE.Vector3());
    const e = g.vehicle.seatAnchor.getWorldPosition(new window.neon.THREE.Vector3());
    return h.distanceTo(e);
  });
  check('head placed at the driver eye point', head < 0.05, String(head));
  await button('right', 'trigger', 1);
  await frames(40);
  await button('right', 'trigger', 0);
  s = await ev(() => window.neon.state());
  check('right trigger throttles the car', s.carSpeed > 1, String(s.carSpeed));
  await page.screenshot({ path: `${OUT}xr_d_driving.png` });
  await button('left', 'trigger', 1);
  await frames(40);
  await button('left', 'trigger', 0);
  await frames(2);

  console.log('E. seated calibration');
  await ev(() => window.neon.exitCar());
  await idle();
  await ev(() => window.neon.xrDevice.position.set(0, 1.1, 0)); // sitting down
  await frames(3);
  await ev(() => window.neon.game.calibrateHeight());
  const offset = await ev(() => window.neon.game.settings.comfort.heightOffset);
  check('height calibration adds ~0.5 m for a seated player', Math.abs(offset - 0.5) < 0.05, String(offset));
  await frames(3);
  const eye = await ev(() => window.neon.game.rig.headWorld(new window.neon.THREE.Vector3()).y);
  check('calibrated eye height ≈ 1.6 m', Math.abs(eye - 1.6) < 0.05, String(eye));

  await ev(() => window.neon.game.renderer.xr.getSession()?.end());
  await page.waitForFunction(() => !window.neon.game.isXR, null, { timeout: 30000 });
  check('session ends cleanly back to desktop', true);
} catch (err) {
  failures++;
  console.log(`  ✗ exception: ${err.stack ?? err}`);
  await page.screenshot({ path: `${OUT}xr_exception.png` }).catch(() => undefined);
}

check('no page errors', errors.length === 0, errors.slice(0, 5).join('\n'));
console.log(`\n${passes} passed, ${failures} failed.`);
await browser.close();
await new Promise((r) => server.httpServer.close(r));
process.exit(failures ? 1 : 0);
