// 모든 레슨·단원 테스트·모의고사 문제를 여러 번 생성해 형식 오류를 찾는다: node nihongo-app/tests/exercises.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const here = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(here, '..', 'web', 'index.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForTimeout(300);

const report = await page.evaluate(() => {
  const problems = [];
  const counts = { lessons: 0, exercises: 0, kinds: {} };
  const norm = App.jp.norm;
  function checkEx(where, ex) {
    if (!ex) { problems.push(`${where}: null exercise`); return; }
    counts.exercises++;
    counts.kinds[ex.kind + ':' + (ex.title || '')] = (counts.kinds[ex.kind + ':' + (ex.title || '')] || 0) + 1;
    if (ex.kind === 'choice') {
      if (!ex.opts || ex.opts.length < 2) problems.push(`${where}: choice has ${ex.opts && ex.opts.length} options`);
      const vals = ex.opts.map((o) => String(o.val));
      if (new Set(vals).size !== vals.length) problems.push(`${where}: duplicate option values`);
      const labels = ex.opts.map((o) => o.html);
      if (new Set(labels).size !== labels.length) problems.push(`${where}: duplicate option labels ${labels.join(' | ')}`);
      if (!vals.includes(String(ex.ans))) problems.push(`${where}: answer not in options`);
      if (ex.opts.length < 4 && !ex.fewOk) problems.push(`${where}: only ${ex.opts.length} options (${ex.title})`);
    } else if (ex.kind === 'build') {
      const tiles = ex.tiles.map((t) => t.val);
      for (const a of ex.ans) {
        const i = tiles.indexOf(a);
        if (i < 0) { problems.push(`${where}: answer tile missing ${a}`); break; }
        tiles.splice(i, 1);
      }
      if (!ex.ans.length) problems.push(`${where}: empty answer`);
    } else if (ex.kind === 'match') {
      if (!ex.pairs || ex.pairs.length < 3) problems.push(`${where}: match with ${ex.pairs && ex.pairs.length} pairs`);
      const r = ex.pairs.map((p) => p.right.html);
      if (new Set(r).size !== r.length) problems.push(`${where}: duplicate match right side`);
    } else if (ex.kind === 'speak') {
      if (!ex.target) problems.push(`${where}: speak without target`);
    } else problems.push(`${where}: unknown kind ${ex.kind}`);
  }
  for (let rep = 0; rep < 4; rep++) {
    for (const lv of App.C.levels) {
      for (const n of App.path.levelNodes(lv)) {
        if (n.type === 'guide' || n.type === 'read') continue;
        const list = App.path.exercises(n);
        counts.lessons++;
        if (list.length < 5) problems.push(`${n.id}: only ${list.length} exercises`);
        list.forEach((ex, i) => checkEx(`${n.id}#${i}`, ex));
      }
      for (const u of lv.units) {
        if (!u._vocab.length && !u._kana.length && !u._grammar.length) continue;
        const t = App.ex.build.unitTest(u);
        if (t.length < 10) problems.push(`${u.id} test: only ${t.length}`);
        t.forEach((ex, i) => checkEx(`${u.id}/test#${i}`, ex));
      }
    }
  }
  for (let rep = 0; rep < 5; rep++) for (const id of ['n5', 'n4', 'n3', 'n2', 'n1']) {
    const parts = App.examBuild(id);
    const n = parts.reduce((a, p) => a + p.list.length, 0);
    if (n < 30) problems.push(`exam ${id}: only ${n} questions`);
    for (const p of parts) {
      if (!p.list.length) problems.push(`exam ${id}: empty part ${p.name}`);
      p.list.forEach((ex, i) => checkEx(`exam ${id}/${p.name}#${i}`, ex));
    }
  }
  // 트레이닝 센터 연습 생성기
  const drillArgs = [];
  for (const lv of ['n5', 'n4', 'n3']) {
    drillArgs.push(['conj', 'auto', lv], ['vgroup', lv], ['adj', 'auto', lv], ['atype', lv], ['ptc', 'all', lv]);
    for (const [k] of App.conj.FORMS) drillArgs.push(['conj', k, lv]);
    for (const [k] of App.conj.AFORMS) drillArgs.push(['adj', k, lv]);
  }
  for (const v of App.conj.verbs) drillArgs.push(['conjv', v.w]);
  for (const t of ['read', 'big', 'listen', 'counter', 'date', 'time', 'price', 'mix']) drillArgs.push(['num', t]);
  for (const P of JPDATA.particles) drillArgs.push(['ptc', P.p]);
  for (const T of JPDATA.compare) drillArgs.push(['cmp', T.id]);
  for (const lv of ['n5', 'n4', 'n3', 'n2']) drillArgs.push(['cmp', 'all', lv]);
  for (const sit of JPDATA.phrases) drillArgs.push(['phr', sit.id]);
  drillArgs.push(['phr', 'all']);
  for (const lv of ['n5', 'n4', 'n3', 'n2', 'n1']) { drillArgs.push(['gq', lv]); for (const t of ['dict', 'mean', 'word', 'mix']) drillArgs.push(['lis', t, lv]); }
  App._listIds = App.C.levelById.n4._vocab.slice(0, 40).map((v) => v.id);
  drillArgs.push(['ids']);
  counts.drills = 0;
  for (let rep = 0; rep < 6; rep++) for (const [key, ...args] of drillArgs) {
    const r = App.drills[key](args);
    const where = `drill ${key}/${args.join('/')}`;
    if (!r || !r.list) { problems.push(`${where}: no drill`); continue; }
    counts.drills++;
    const min = key === 'conjv' ? 6 : key === 'cmp' && args[0] !== 'all' ? 4 : 8;
    if (r.list.length < min) problems.push(`${where}: only ${r.list.length} exercises`);
    r.list.forEach((ex, i) => checkEx(`${where}#${i}`, ex));
  }
  return { problems: [...new Set(problems)], counts };
});

console.log(`lessons generated: ${report.counts.lessons}, drills: ${report.counts.drills}, exercises: ${report.counts.exercises}`);
console.log('exercise kinds:', Object.entries(report.counts.kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', '));
if (report.problems.length) {
  console.log(`\n${report.problems.length} problem(s):`);
  for (const p of report.problems.slice(0, 80)) console.log('  ✖ ' + p);
}
if (errors.length) console.log('page errors:', errors);
await browser.close();
process.exit(report.problems.length || errors.length ? 1 : 0);
