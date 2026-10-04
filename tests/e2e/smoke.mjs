/**
 * End-to-end smoke test (desktop path) in headless Chromium.
 *
 *   npm run build && npm run smoke
 *
 * Starts `vite preview`, drives the game through window.neon (QA API) and
 * simulated keyboard input, asserts the full vertical-slice loop and saves
 * screenshots to tests/e2e/out/. WebGL runs on SwiftShader (software), so frame
 * rates here say nothing about headset performance.
 */
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
import { chromium } from 'playwright-core';

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 4190;

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
const state = () => ev(() => window.neon.state());
async function frames(n) {
  const start = await ev(() => window.neon.game.frameCount);
  await page.waitForFunction((t) => window.neon.game.frameCount >= t, start + n, { timeout: 120000 });
}
async function hold(code, n) {
  await ev((c) => window.neon.key(c, true), code);
  await frames(n);
  await ev((c) => window.neon.key(c, false), code);
  await frames(1);
}
async function tap(code) {
  await hold(code, 2);
}
/** Teleport and wait for the fade-out/in to finish. */
async function teleport(x, z, yaw = 0) {
  await ev(([x, z, yaw]) => window.neon.teleport(x, z, yaw), [x, z, yaw]);
  await page.waitForFunction(() => !window.neon.game.player.busy, null, { timeout: 60000 });
  await frames(2);
}
async function shot(name) {
  await page.screenshot({ path: `${OUT}${name}.png` });
}
async function load(query = '') {
  await page.goto(`http://127.0.0.1:${PORT}/${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.neon && window.neon.game.frameCount > 2, null, { timeout: 120000 });
}

try {
  console.log('A. boot');
  await load('?new');
  const status0 = await ev(() => window.neon.start('desktop', true));
  await ev(() => window.neon.setSetting('graphics.quality', 'low'));
  await frames(5);
  let s = await state();
  check('starts on foot with $100 and no wanted level', s.mode === 'foot' && s.money === 100 && s.wanted === 0, JSON.stringify(s));
  check('new game reports missing save', status0 === 'missing', status0);
  await shot('a_spawn');

  console.log('B. VR-style locomotion (desktop equivalents)');
  const z0 = s.pos[1];
  await hold('KeyW', 25);
  s = await state();
  check('smooth move forward', z0 - s.pos[1] > 0.5, `${z0} -> ${s.pos[1]}`);
  const yaw0 = await ev(() => window.neon.game.rig.rigYaw());
  await tap('KeyQ');
  const yaw1 = await ev(() => window.neon.game.rig.rigYaw());
  check('snap turn rotates 45°', Math.abs(Math.abs(yaw1 - yaw0) - Math.PI / 4) < 0.05, `${yaw0} -> ${yaw1}`);
  await teleport(-56, -26, 0);
  await ev(() => window.neon.lookAt(-56, 0, -34));
  await ev(() => window.neon.key('KeyT', true));
  await frames(4);
  const tpValid = await ev(() => window.neon.game.teleport.valid);
  await ev(() => window.neon.key('KeyT', false));
  await frames(12);
  s = await state();
  check('teleport arc valid on open ground', tpValid);
  check('teleport moved the player', Math.abs(s.pos[1] - -26) > 2, JSON.stringify(s.pos));
  await ev(() => window.neon.lookAt(-44.5, 0.2, -16)); // look at a fountain-side wall: arc into geometry
  await frames(2);

  console.log('C. mission giver');
  await teleport(-45, -22.3, 0);
  await tap('KeyE');
  await frames(3);
  check('talking to MIKA opens the mission board', await ev(() => window.neon.game.giver.boardOpen));
  await shot('c_mika_board');
  check('accept mission', await ev(() => window.neon.acceptMission()));
  s = await state();
  check('delivery mission active at first objective', s.mission === 'm1_delivery' && s.objective === 'go_store', JSON.stringify(s));

  console.log('D. store door + interior');
  await teleport(51, -15.8, 0);
  s = await state();
  check('arriving at the store advances the objective', s.objective === 'take_pkg', s.objective);
  await ev(() => window.neon.lookAt(51.72, 1.05, -18.15));
  await frames(3);
  const hoverDoor = (await state()).hover[0];
  await tap('KeyE');
  await frames(25);
  check('door hovered by the view ray', hoverDoor === 'store_door', String(hoverDoor));
  check('door opens on interact', await ev(() => window.neon.game.landmarks.storeDoor.isOpen));
  await teleport(47.7, -26.8, Math.PI / 2);
  await ev(() => window.neon.lookAt(45.6, 1.18, -26.8));
  await frames(3);
  s = await state();
  check('package hovered', s.hover[0] === 'package_m1', String(s.hover[0]));
  await tap('KeyF');
  await frames(3);
  s = await state();
  check('grab package with F (desktop hand)', s.held[0] === 'package_m1', JSON.stringify(s.held));
  check('pickup objective completes', s.objective === 'drive', s.objective);
  await shot('d_store_holding');

  console.log('E. vehicle enter / drive');
  await ev(() => window.neon.gotoCar());
  await page.waitForFunction(() => !window.neon.game.player.busy, null, { timeout: 60000 });
  await frames(2);
  check('car prompt near door', (await ev(() => window.neon.game.player.prompt(false))) !== null);
  await tap('KeyE');
  await page.waitForFunction(() => window.neon.game.player.mode === 'driving' && !window.neon.game.player.busy, null, { timeout: 60000 });
  s = await state();
  check('entered the driver seat', s.mode === 'driving');
  check('package rides on the passenger seat', (await ev(() => window.neon.game.vehicle.passengerSocket.item?.id)) === 'package_m1');
  check('enter-vehicle objective completes', s.objective === 'deliver', s.objective);
  await shot('e_driver_seat');
  const p0 = s.pos;
  await hold('KeyW', 45);
  s = await state();
  check('throttle accelerates the car', s.carSpeed > 2, String(s.carSpeed));
  check('car moved', Math.hypot(s.pos[0] - p0[0], s.pos[1] - p0[1]) > 1.5, `${p0} -> ${s.pos}`);
  const cy0 = await ev(() => window.neon.game.vehicle.physics.yaw());
  await ev(() => window.neon.key('KeyW', true));
  await hold('KeyD', 20);
  await ev(() => window.neon.key('KeyW', false));
  const cy1 = await ev(() => window.neon.game.vehicle.physics.yaw());
  check('steering changes heading', Math.abs(cy1 - cy0) > 0.05, `${cy0} -> ${cy1}`);
  await hold('KeyS', 40);
  await shot('e_driving');

  console.log('F. delivery');
  await ev(() => window.neon.callCarTo(-107, 58));
  await frames(20);
  await hold('KeyS', 5);
  await tap('KeyE');
  await page.waitForFunction(() => window.neon.game.player.mode === 'foot' && !window.neon.game.player.busy, null, { timeout: 60000 });
  s = await state();
  check('exit vehicle on foot', s.mode === 'foot');
  const seat = await ev(() => {
    const p = window.neon.game.vehicle.passengerSocket.anchor.getWorldPosition(new window.neon.THREE.Vector3());
    return [p.x, p.y, p.z];
  });
  const carC = await ev(() => {
    const p = window.neon.game.vehicle.worldPosition(new window.neon.THREE.Vector3());
    return [p.x, p.z];
  });
  // Stand on the passenger side, look at the parcel and grab it.
  const side = [seat[0] + (seat[0] - carC[0]) * 1.6, seat[2] + (seat[2] - carC[1]) * 1.6];
  await teleport(side[0], side[1], 0);
  const seatNow = await ev(() => window.neon.game.missionWorld.items.get('package_m1').object.position.toArray());
  await ev(([x, y, z]) => window.neon.lookAt(x, y, z), seatNow);
  await frames(3);
  if (process.env.SMOKE_DEBUG) {
    console.log('    debug', JSON.stringify(await ev(() => {
      const g = window.neon.game;
      const T = window.neon.THREE;
      const it = g.missionWorld.items.get('package_m1');
      return { hover: g.desktopHand.hover?.id, item: it.object.position.toArray(), socket: it.socket?.id, head: g.rig.headWorld(new T.Vector3()).toArray(), held: g.desktopHand.held?.id, mode: g.player.mode };
    })), JSON.stringify(seat), JSON.stringify(side));
  }
  await tap('KeyF');
  await frames(3);
  s = await state();
  check('take the parcel back off the seat', s.held[0] === 'package_m1', JSON.stringify(s.held) + ' hover=' + s.hover[0]);
  if (s.held[0] !== 'package_m1') await ev(() => window.neon.grab('package_m1'));
  await teleport(-101.45, 62, -Math.PI / 2);
  await ev(() => window.neon.lookAt(-100.7, 0.7, 62));
  await frames(4);
  await tap('KeyF');
  await frames(6);
  let socketed = await ev(() => window.neon.game.missionWorld.itemInSocket('package_m1', 'kai_dropbox'));
  check('release over the drop box snaps the parcel in', socketed);
  if (!socketed) await ev(() => window.neon.dropInto('package_m1', 'kai_dropbox'));
  await frames(6);
  s = await state();
  check('delivery mission completed', s.completed.includes('m1_delivery') && s.mission === null, JSON.stringify(s));
  check('reward paid once ($100 + $250)', s.money === 350, String(s.money));
  await shot('f_delivered');

  console.log('G. wanted level + escape');
  await ev(() => {
    const t = window.neon.tuning.police;
    t.cooldownTime = [0, 4, 4, 4];
    t.lostSightTime = 1;
  });
  await teleport(-8, -40, 0);
  await ev(() => window.neon.setWanted(2));
  await frames(20);
  s = await state();
  check('wanted level 2 dispatches police', s.wanted === 2 && s.police.some((p) => /respond|pursue|search/.test(p)), JSON.stringify(s.police));
  await shot('g_wanted');
  await ev(() => window.neon.teleport(-102, 102, 0));
  await page.waitForFunction(() => window.neon.game.wanted.level === 0, null, { timeout: 120000 });
  s = await state();
  check('escaping out of sight + search radius clears wanted', s.wanted === 0);
  await frames(30);
  s = await state();
  check('police stand down after clearing', !s.police.some((p) => /respond|pursue|search/.test(p)), JSON.stringify(s.police));

  console.log('G2. busted');
  const moneyBefore = (await state()).money;
  const officer = await ev(() => {
    const o = window.neon.game.police.officers[0];
    return [o.x, o.z];
  });
  await teleport(officer[0] + 1.2, officer[1], 0);
  await ev(() => window.neon.setWanted(1));
  await page.waitForFunction(() => window.neon.game.wanted.level === 0 && !window.neon.game.player.busy, null, { timeout: 90000 });
  s = await state();
  const precinct = await ev(() => window.neon.spawns.precinct);
  check('officer next to an on-foot wanted player arrests them', Math.hypot(s.pos[0] - precinct.x, s.pos[1] - precinct.z) < 3, JSON.stringify(s.pos));
  check('arrest costs a fine', s.money < moneyBefore, `${moneyBefore} -> ${s.money}`);

  console.log('H. weapon + crime witnesses');
  await teleport(-60, -40, 0);
  check('grab blaster via API', await ev(() => window.neon.grab('volt_pulse')));
  await ev(() => window.neon.game.blaster.fire(null));
  await frames(10);
  const crimeLog = await ev(() => window.neon.game.crimes.log.join(' | '));
  check('firing is evaluated as a witnessed/unwitnessed crime', /shots_fired/.test(crimeLog), crimeLog);
  await ev(() => {
    window.neon.game.wanted.clear();
    window.neon.game.crimes.clearPending();
  });

  console.log('I. mission restart mid-way');
  check('accept next mission (neon run)', await ev(() => window.neon.acceptMission()));
  await ev(() => window.neon.gotoCar());
  await page.waitForFunction(() => !window.neon.game.player.busy, null, { timeout: 60000 });
  await frames(2);
  await ev(() => window.neon.enterCar());
  await frames(20);
  s = await state();
  check('race objective active after entering car', s.mission === 'm2_neon_run' && s.objective === 'race', JSON.stringify(s));
  check('checkpoint gates visible', await ev(() => window.neon.game.markers.group.children.some((c) => c.visible && c.position.x === -60)));
  await ev(() => window.neon.game.restartMission());
  await frames(5);
  s = await state();
  check('restart returns to the first objective', s.mission === 'm2_neon_run' && s.objective === 'race', JSON.stringify(s));
  await ev(() => window.neon.game.abandonMission());
  await frames(3);
  check('abandon clears the mission', (await state()).mission === null);

  console.log('J. flip + stuck recovery');
  await ev(() => window.neon.flipCar());
  await page.waitForFunction(() => window.neon.game.vehicle.physics.isFlipped, null, { timeout: 60000 });
  check('flip detected', true);
  check('flip prompt offered', /복구/.test((await ev(() => window.neon.game.player.prompt(false))) ?? ''));
  await shot('j_flipped');
  await tap('KeyR');
  await page.waitForFunction(() => !window.neon.game.player.busy, null, { timeout: 60000 });
  await frames(20);
  s = await state();
  check('car recovered upright on the road', s.carUp > 0.95 && !s.flipped, JSON.stringify(s));
  // Wedge the car nose-first into the KARAOKE building and floor it.
  await ev(() => window.neon.placeCar(-34.6, -57, -Math.PI / 2));
  await frames(10);
  await ev(() => window.neon.key('KeyW', true));
  await page.waitForFunction(() => window.neon.game.vehicle.physics.isStuck, null, { timeout: 90000 });
  await ev(() => window.neon.key('KeyW', false));
  check('stuck against a wall detected', true);
  await tap('KeyR');
  await page.waitForFunction(() => !window.neon.game.player.busy, null, { timeout: 60000 });
  await frames(10);
  const onRoad = await ev(() => {
    const g = window.neon.game;
    const p = g.vehicle.worldPosition(new window.neon.THREE.Vector3());
    return g.roads.isOnRoad(p.x, p.z) && !g.vehicle.physics.isStuck;
  });
  check('stuck car recovered onto a road', onRoad);
  await ev(() => window.neon.exitCar());
  await page.waitForFunction(() => window.neon.game.player.mode === 'foot' && !window.neon.game.player.busy, null, { timeout: 60000 });

  console.log('K. save / reload / corruption');
  await ev(() => window.neon.setSetting('comfort.turnMode', 'smooth'));
  await ev(() => window.neon.setSetting('comfort.stance', 'seated'));
  const moneySaved = (await state()).money;
  check('manual save', await ev(() => window.neon.save()));
  await load();
  const st1 = await ev(() => window.neon.start('desktop', false));
  await frames(5);
  s = await state();
  check('reload restores progress', st1 === 'ok' && s.money === moneySaved && s.completed.includes('m1_delivery'), `${st1} ${moneySaved} ${JSON.stringify(s)}`);
  check('reload restores comfort settings', await ev(() => window.neon.game.settings.comfort.turnMode === 'smooth' && window.neon.game.settings.comfort.stance === 'seated'));
  await ev(() => window.neon.save());
  await ev(() => window.neon.corruptSave());
  await load();
  const st2 = await ev(() => window.neon.start('desktop', false));
  await frames(5);
  s = await state();
  check('corrupted save falls back to backup', st2 === 'corrupt-recovered-backup' && s.completed.includes('m1_delivery'), st2);
  await ev(() => window.neon.clearSave());
  await load();
  const st3 = await ev(() => window.neon.start('desktop', false));
  await frames(5);
  s = await state();
  check('missing save starts with defaults', st3 === 'missing' && s.money === 100 && s.completed.length === 0, `${st3} ${JSON.stringify(s)}`);

  const perf = await ev(() => ({ calls: window.neon.game.renderer.info.render.calls, tris: window.neon.game.renderer.info.render.triangles }));
  console.log(`  info: draw calls ${perf.calls}, triangles ${perf.tris} (SwiftShader run, not a performance measurement)`);
} catch (err) {
  failures++;
  console.log(`  ✗ exception: ${err.stack ?? err}`);
  await shot('zz_exception').catch(() => undefined);
}

check('no page errors', errors.length === 0, errors.slice(0, 5).join('\n'));
console.log(`\n${passes} passed, ${failures} failed. Screenshots: ${OUT}`);
await browser.close();
await new Promise((r) => server.httpServer.close(r));
process.exit(failures ? 1 : 0);
