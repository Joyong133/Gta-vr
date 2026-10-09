// 모바일 뷰포트에서 앱 전체 흐름을 자동으로 점검: node nihongo-app/tests/smoke.mjs
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const here = path.dirname(fileURLToPath(import.meta.url));
const indexUrl = pathToFileURL(path.join(here, '..', 'web', 'index.html')).href;
const outDir = process.env.SHOTS || path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const shot = async (name) => page.screenshot({ path: path.join(outDir, name + '.png') });
const go = async (route) => { await page.evaluate((r) => App.go(r), route); await page.waitForTimeout(250); };
const step = (s) => console.log('▶ ' + s);

await page.goto(indexUrl);
await page.waitForTimeout(400);

step('onboarding');
await shot('00-onboard');
await page.click('.onboard .btn.primary');
await page.fill('.onboard input', '테스터');
await page.click('.onboard .btn.primary');
await page.click('.ob-opt >> nth=0');
await page.click('.ob-opt >> nth=1');
await shot('01-onboard-done');
await page.click('.onboard .btn.primary');
await page.waitForTimeout(300);
await shot('02-home');

// 레슨 자동 풀이: 정답을 알고 푸는 모드(ok=true) / 첫 보기 고르기(ok=false)
async function playLesson({ correct = true, max = 80 } = {}) {
  for (let n = 0; n < max; n++) {
    await page.waitForTimeout(60);
    if (await page.$('.modal .celebrate')) { await page.click('.modal .btn.primary'); await page.waitForTimeout(250); }
    if (await page.$('.result')) return true;
    const kind = await page.evaluate(() => {
      if (App.$('.match')) return 'match';
      if (App.$('.opts')) return 'choice';
      if (App.$('.build-bank')) return 'build';
      if (App.$('.mic')) return 'speak';
      if (App.$('.guide-page') || App.$('.passage')) return 'page';
      return 'none';
    });
    if (kind === 'match') {
      const L = await page.$$('.mcol:first-child .mbtn');
      const R = await page.$$('.mcol:last-child .mbtn');
      for (const l of L) {
        for (const r of R) {
          if (await l.evaluate((x) => x.classList.contains('done'))) break;
          if (await r.evaluate((x) => x.classList.contains('done'))) continue;
          await l.click();
          await r.click();
          await page.waitForTimeout(470);
        }
      }
      await page.waitForTimeout(400);
      continue;
    }
    if (kind === 'choice') {
      if (correct) {
        await page.evaluate(() => {
          const lesson = document.querySelector('.ex-mount');
          const btns = [...lesson.querySelectorAll('.opt')];
          // 정답 찾기: 렌더러가 보관한 값을 내부 상태와 비교
          const ex = window.__curEx;
          const b = ex ? btns.find((x) => String(x._val) === String(ex.ans)) : btns[0];
          (b || btns[0]).click();
        });
      } else await page.click('.opt >> nth=0');
    } else if (kind === 'build') {
      if (correct) {
        await page.evaluate(() => {
          const ex = window.__curEx;
          const tiles = [...document.querySelectorAll('.build-bank .tile:not(.ghost)')];
          const used = new Set();
          for (const a of ex.ans) {
            const idx = ex.tiles.findIndex((tt, i) => !used.has(i) && tt.val === a);
            used.add(idx);
            const el = [...document.querySelectorAll('.build-bank .slot')][idx].querySelector('.tile:not(.ghost)');
            el && el.click();
          }
        });
      } else await page.click('.build-bank .tile:not(.ghost) >> nth=0');
    } else if (kind === 'speak') {
      await page.click('.cant');
      continue;
    } else if (kind === 'page') {
      await page.click('.check');
      continue;
    } else {
      await page.waitForTimeout(200);
    }
    const disabled = await page.$eval('.check', (b) => b.disabled).catch(() => true);
    if (!disabled) await page.click('.check');
    await page.waitForTimeout(120);
    if (await page.$('.feedback.show')) await page.click('.feedback.show .btn.block');
    // 하트 소진 시트
    if (await page.$('.modal .hearts-big')) { await page.click('.modal .btn.ghost >> nth=1'); return false; }
  }
  return !!(await page.$('.result'));
}

// 렌더된 문제를 테스트에서 참조할 수 있게 훅 설치
await page.evaluate(() => {
  const orig = App.ex.render;
  App.ex.render = (ex, mount, ctx) => { window.__curEx = ex; return orig(ex, mount, ctx); };
});

for (const r of ['course', 'level/kana', 'level/n5', 'unit/kana-1', 'unit/n5-1', 'path', 'review', 'more', 'stats', 'ach', 'league', 'shop', 'settings', 'about', 'kana', 'dict', 'focus', 'exam', 'write/あ']) {
  step('screen ' + r);
  await go(r);
  await shot('s-' + r.replace(/\//g, '_'));
}

step('unit tabs');
await go('unit/n5-4');
for (const t of await page.$$('.tb')) { await t.click(); await page.waitForTimeout(120); }
await shot('u-n5-4-last');
await page.click('.tb >> nth=0');
await shot('u-n5-4-grammar');

step('path lesson (guide + kana)');
for (let k = 0; k < 4; k++) {
  const id = await page.evaluate(() => App.path.current().id);
  await go('lesson/node/' + encodeURIComponent(id));
  if (k === 1) await shot('l-kana-q');
  const ok = await playLesson({ correct: true });
  await shot('l-result-' + k);
  if (!ok) throw new Error('lesson did not finish: ' + id);
  if (await page.$('.modal .celebrate')) { await page.click('.modal .btn.primary'); await page.waitForTimeout(250); }
  await page.click('.result .btn.primary');
  await page.waitForTimeout(150);
}
await go('path');
await shot('p-after');

step('N5 vocab/grammar lessons');
for (const id of ['n5-1:vocab0', 'n5-1:grammar0', 'n5-1:kanji0', 'n5-1:talk0', 'n5-4:read0', 'n5-1:review0']) {
  await go('lesson/node/' + encodeURIComponent(id));
  await page.waitForTimeout(200);
  if (id.includes('grammar')) await shot('l-grammar-q');
  if (id.includes('talk')) await shot('l-talk-q');
  const ok = await playLesson({ correct: true });
  if (!ok) throw new Error('lesson did not finish: ' + id);
  if (await page.$('.modal .celebrate')) { await page.click('.modal .btn.primary'); await page.waitForTimeout(250); }
  await page.click('.result .btn.primary');
}

step('wrong answers (hearts)');
await go('lesson/node/' + encodeURIComponent('n5-2:vocab0'));
await playLesson({ correct: false, max: 12 });
await shot('l-wrong');
await go('home');

step('unit test');
await go('lesson/test/n5-3');
await playLesson({ correct: true });
await shot('t-result');
await page.click('.result .btn.primary');

step('flashcards');
await page.evaluate(() => { for (const c of Object.values(App.store.state.srs)) c.due = Date.now() - 1000; App.store.save(); });
await go('cards/srs/all');
await shot('c-front');
await page.click('.card-controls .btn');
await page.waitForTimeout(500);
await shot('c-back');
for (let i = 0; i < 4; i++) { if (await page.$('.grade.good')) { await page.click('.grade.good'); await page.waitForTimeout(80); await page.click('.card-controls .btn').catch(() => {}); await page.waitForTimeout(80); } }
await page.evaluate(() => App.back());
await page.waitForTimeout(200);
if (await page.$('.modal')) await page.click('.modal .btn.primary');

step('exam');
await go('exam/n5');
await shot('e-run');
for (let i = 0; i < 60; i++) {
  if (await page.$('.opts .opt')) await page.click('.opts .opt >> nth=0');
  const txt = await page.$eval('.lesson-foot .btn.primary', (b) => b.textContent);
  await page.click('.lesson-foot .btn.primary');
  await page.waitForTimeout(40);
  if (txt.includes('제출')) break;
}
await page.waitForTimeout(150);
if (await page.$('.modal')) await page.click('.modal .btn.primary');
await page.waitForTimeout(300);
await shot('e-result');

step('focus');
await go('focus');
await page.click('.focus-page .btn.primary');
await page.waitForTimeout(1200);
await shot('f-running');
await page.click('.focus-page .btn.ghost >> nth=1');

step('dict search');
await go('dict');
await page.fill('.search', '먹');
await page.waitForTimeout(400);
await shot('d-search');

step('dark mode');
await page.evaluate(() => { App.store.state.settings.theme = 'dark'; App.applyTheme(); });
await go('home');
await shot('z-dark-home');
await go('path');
await shot('z-dark-path');
await go('unit/n5-5');
await shot('z-dark-unit');

step('back navigation');
const backs = await page.evaluate(() => { const r = []; for (let i = 0; i < 6; i++) r.push(App.handleBack()); return r; });
console.log('  back results', backs.join(','));

await browser.close();
if (errors.length) {
  console.log('\n✖ errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\n✔ smoke OK — screenshots in ' + outDir);
