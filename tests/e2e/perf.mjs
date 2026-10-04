/**
 * CPU frame-cost probe (headless Chromium + SwiftShader).
 *
 *   npm run build && node tests/e2e/perf.mjs
 *
 * Reports the game's own per-section CPU timings (PerfMonitor) at a few fixed
 * viewpoints. GPU work is software-rasterised here, so render numbers and FPS
 * are NOT representative of a headset; the "update" (game logic) cost is the
 * meaningful number. Measure on real hardware with the F3 / menu debug overlay.
 */
import { preview } from 'vite';
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 4193;
const server = await preview({ preview: { port: PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(`http://127.0.0.1:${PORT}/?new`, { waitUntil: 'load' });
await page.waitForFunction(() => window.neon && window.neon.game.frameCount > 2, null, { timeout: 120000 });
await page.evaluate(() => window.neon.start('desktop', true));
const ev = (fn, a) => page.evaluate(fn, a);
async function frames(n) {
  const s = await ev(() => window.neon.game.frameCount);
  await page.waitForFunction((t) => window.neon.game.frameCount >= t, s + n, { timeout: 300000 });
}
async function sample(label, quality) {
  await ev((q) => window.neon.setSetting('graphics.quality', q), quality);
  await frames(30);
  const r = await ev(() => {
    const p = window.neon.game.perf;
    const i = window.neon.game.renderer.info.render;
    return {
      update: p.sectionMs('update'),
      physics: p.sectionMs('physics'),
      ai: p.sectionMs('ai'),
      interaction: p.sectionMs('interaction'),
      ui: p.sectionMs('ui'),
      render: p.sectionMs('render'),
      calls: i.calls,
      tris: i.triangles,
    };
  });
  console.log(
    `${label.padEnd(28)} q=${quality.padEnd(6)} update ${r.update.toFixed(2)}ms (physics ${r.physics.toFixed(2)}, ai ${r.ai.toFixed(2)}, interact ${r.interaction.toFixed(2)}, ui ${r.ui.toFixed(2)})  render-submit ${r.render.toFixed(1)}ms  calls ${r.calls}  tris ${(r.tris / 1000).toFixed(0)}k`,
  );
}
await sample('plaza spawn (on foot)', 'medium');
await sample('plaza spawn (on foot)', 'low');
await ev(() => window.neon.gotoCar());
await page.waitForFunction(() => !window.neon.game.player.busy, null, { timeout: 60000 });
await ev(() => window.neon.enterCar());
await page.waitForFunction(() => window.neon.game.player.mode === 'driving' && !window.neon.game.player.busy, null, { timeout: 60000 });
await ev(() => window.neon.key('KeyW', true));
await sample('driving (plaza exit)', 'medium');
await ev(() => window.neon.key('KeyW', false));
await ev(() => window.neon.setWanted(3));
await sample('wanted 3, police active', 'medium');
await browser.close();
await new Promise((r) => server.httpServer.close(r));
