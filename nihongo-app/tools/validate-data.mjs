// 학습 데이터 무결성 검사: node nihongo-app/tools/validate-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'web', 'data');
const order = ['kana.js', 'n5.js', 'n4.js', 'n3.js', 'n2.js', 'n1.js', 'vocab-plus.js', 'vocab-plus2.js', 'extra.js', 'verbs.js', 'particles.js', 'compare.js', 'phrases.js'];

const ctx = { window: {} };
vm.createContext(ctx);
for (const f of order) {
  const p = path.join(dataDir, f);
  if (!fs.existsSync(p)) continue;
  vm.runInContext(fs.readFileSync(p, 'utf8').replace(/^window\.JPDATA = window\.JPDATA \|\|/m, 'var JPDATA = window.JPDATA = window.JPDATA ||'), ctx, { filename: f });
}
const D = ctx.window.JPDATA;

const errors = [];
const warns = [];
const KANJI = /[一-鿿々〆ヵヶ]/;
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warns.push(`${where}: ${msg}`);

function checkJp(where, s, { requireRuby = false } = {}) {
  if (typeof s !== 'string' || !s.trim()) return err(where, 'empty japanese text');
  let depth = 0;
  for (const ch of s) {
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (depth < 0 || depth > 1) return err(where, `unbalanced brackets: ${s}`);
  }
  if (depth !== 0) return err(where, `unbalanced brackets: ${s}`);
  const re = /([^\s\[\]]?)\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(s))) {
    if (!KANJI.test(m[1])) err(where, `ruby not after kanji: "${m[0]}" in ${s}`);
    if (!m[2] || /[一-鿿]/.test(m[2])) err(where, `bad ruby reading "${m[2]}" in ${s}`);
  }
  if (requireRuby) {
    const bare = s.replace(/[一-鿿々〆ヵヶ]+\[[^\]]*\]/g, '');
    if (KANJI.test(bare)) warn(where, `kanji without reading: ${s}`);
  }
}

const ids = new Set();
const stats = {};
for (const lv of D.levels) {
  const st = (stats[lv.id] = { units: 0, grammar: 0, vocab: 0, kanji: 0, quiz: 0, examples: 0, reading: 0, talk: 0 });
  if (!lv.units?.length) err(lv.id, 'no units');
  for (const u of lv.units) {
    st.units++;
    const W = `${lv.id}/${u.id}`;
    if (ids.has(u.id)) err(W, 'duplicate unit id');
    ids.add(u.id);
    if (!u.title || !u.goal) err(W, 'missing title/goal');
    for (const g of u.grammar || []) {
      st.grammar++;
      const G = `${W}/${g.id}`;
      if (ids.has(g.id)) err(G, 'duplicate grammar id');
      ids.add(g.id);
      for (const k of ['p', 'm', 'f', 'e']) if (!g[k]) err(G, `missing ${k}`);
      if (!g.ex?.length) err(G, 'no examples');
      for (const [i, ex] of (g.ex || []).entries()) {
        st.examples++;
        if (!Array.isArray(ex) || ex.length !== 2 || !ex[1]) err(G, `bad example #${i}`);
        else checkJp(`${G}/ex${i}`, ex[0], { requireRuby: lv.id !== 'n1' && lv.id !== 'n2' });
      }
      for (const [i, q] of (g.q || []).entries()) {
        st.quiz++;
        const Q = `${G}/q${i}`;
        if (!Array.isArray(q) || q.length < 3) { err(Q, 'bad quiz shape'); continue; }
        const [stem, opts, ans] = q;
        checkJp(Q, stem);
        if (!Array.isArray(opts) || opts.length !== 4) err(Q, 'need 4 options');
        else {
          if (new Set(opts).size !== 4) err(Q, `duplicate options ${opts}`);
          opts.forEach((o, j) => checkJp(`${Q}/opt${j}`, o));
        }
        if (!(ans >= 0 && ans < 4)) err(Q, 'answer index out of range');
        if (!/（　）|\(　\)|＿/.test(stem) && !/[?？]|은\?|나요|것은/.test(stem)) warn(Q, `stem has no blank: ${stem}`);
      }
      if (!g.q?.length) warn(G, 'no quiz');
    }
    for (const [i, v] of (u.vocab || []).entries()) {
      st.vocab++;
      const V = `${W}/v${i}`;
      if (!Array.isArray(v) || v.length < 3) { err(V, 'bad vocab'); continue; }
      if (!v[0] || !v[2]) err(V, `missing word/meaning ${v}`);
      if (KANJI.test(v[0]) && !v[1]) err(V, `kanji word without reading: ${v[0]}`);
      if (v[1] && /[一-鿿]/.test(v[1])) err(V, `reading contains kanji: ${v[1]}`);
      if (v[3]) { checkJp(`${V}/ex`, v[3]); if (!v[4]) err(V, 'example without translation'); }
    }
    for (const [i, k] of (u.kanji || []).entries()) {
      st.kanji++;
      const K = `${W}/k${i}`;
      if (!Array.isArray(k) || k.length !== 5) { err(K, `bad kanji entry ${k}`); continue; }
      if ([...k[0]].length !== 1) err(K, `kanji must be one char: ${k[0]}`);
      for (const part of k[4].split(/,\s*/)) {
        const [w, mean] = part.split(':');
        if (!w || !mean) err(K, `bad kanji example "${part}"`);
        else checkJp(K, w);
      }
    }
    for (const [i, t] of (u.talk || []).entries()) {
      st.talk++;
      if (t.length !== 3) err(`${W}/talk${i}`, 'bad talk line');
      else checkJp(`${W}/talk${i}`, t[1]);
    }
    for (const [i, r] of (u.reading || []).entries()) {
      st.reading++;
      const R = `${W}/r${i}`;
      if (!r.t || !r.jp || !r.ko) err(R, 'missing reading fields');
      else checkJp(R, r.jp);
      for (const [j, q] of (r.q || []).entries()) {
        if (q[1]?.length !== 4 || !(q[2] >= 0 && q[2] < 4)) err(`${R}/q${j}`, 'bad reading question');
        else if (new Set(q[1]).size !== 4) err(`${R}/q${j}`, 'duplicate options');
      }
    }
  }
}

// 한자 중복(레벨 전체) 경고
{
  const seenK = new Map();
  for (const lv of D.levels) for (const u of lv.units) for (const k of u.kanji || []) {
    if (seenK.has(k[0])) warn('kanji', `duplicate kanji ${k[0]} (${seenK.get(k[0])} & ${u.id})`);
    else seenK.set(k[0], u.id);
  }
}
// 중복 단어(같은 레벨 내) 경고
for (const lv of D.levels) {
  const seen = new Map();
  for (const u of lv.units) for (const v of u.vocab || []) {
    const key = v[0] + '|' + v[1];
    if (seen.has(key)) warn(lv.id, `duplicate vocab ${v[0]} (${seen.get(key)} & ${u.id})`);
    else seen.set(key, u.id);
  }
}

/* ───────── 트레이닝 데이터 ───────── */
const KANA_ONLY = /^[ぁ-ゖァ-ヺー]+$/;
// 표기의 가나 부분이 읽기와 맞는지 (후리가나 자동 정렬이 되는지)
function aligns(w, r) {
  const segs = w.match(/[一-鿿々〆ヵヶ]+|[^一-鿿々〆ヵヶ]+/g) || [];
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^' + segs.map((x) => (/[一-鿿々]/.test(x) ? '(.+?)' : esc(x))).join('') + '$');
  return re.test(r);
}
const IE_ROW = /[いきぎしじちぢにひびぴみりえけげせぜてでねへべぺめれ]る$/;
const tstats = { verbs: 0, adjs: 0, particles: 0, ptcQuiz: 0, compare: 0, cmpQuiz: 0, phrases: 0, situations: 0 };
{
  const seen = new Set();
  for (const [i, v] of (D.verbs || []).entries()) {
    tstats.verbs++;
    const W = `verbs/${i}:${v[0]}`;
    if (v.length < 5) { err(W, 'bad verb entry'); continue; }
    const [w, r, m, g, lv] = v;
    if (seen.has(w)) err(W, 'duplicate verb');
    seen.add(w);
    if (!KANA_ONLY.test(r)) err(W, `reading must be kana: ${r}`);
    if (!m) err(W, 'missing meaning');
    if (![1, 2, 3].includes(g)) err(W, 'group must be 1/2/3');
    if (!['n5', 'n4', 'n3', 'n2', 'n1'].includes(lv)) err(W, 'bad level');
    if (w.slice(-1) !== r.slice(-1)) err(W, 'word and reading must share the last kana');
    if (g === 2 && !IE_ROW.test(r)) err(W, 'group 2 verb must end in -iru/-eru');
    if (g === 3 && !/(する|くる)$/.test(r)) err(W, 'group 3 verb must end in する/来る');
    if (g === 1 && !/[うくぐすつぬぶむる]$/.test(r)) err(W, 'group 1 verb must end in u-row kana');
    if (!aligns(w, r)) err(W, `reading does not align with kana in word: ${w} / ${r}`);
  }
  const seenA = new Set();
  for (const [i, a] of (D.adjs || []).entries()) {
    tstats.adjs++;
    const W = `adjs/${i}:${a[0]}`;
    const [w, r, m, t, lv] = a;
    if (seenA.has(w)) err(W, 'duplicate adjective');
    seenA.add(w);
    if (!KANA_ONLY.test(r)) err(W, `reading must be kana: ${r}`);
    if (!m || !['i', 'na'].includes(t) || !lv) err(W, 'bad adjective entry');
    if (t === 'i' && !/い$/.test(r)) err(W, 'i-adjective must end in い');
    if (!aligns(w, r)) err(W, `reading does not align: ${w} / ${r}`);
  }
  for (const P of D.particles || []) {
    tstats.particles++;
    const W = `particles/${P.p}`;
    if (!P.p || !P.name || !P.sum || !P.lv) err(W, 'missing fields');
    for (const [j, u] of (P.uses || []).entries()) {
      if (u.length !== 4) err(`${W}/use${j}`, 'bad use');
      else checkJp(`${W}/use${j}`, u[2]);
    }
    for (const [j, q] of (P.q || []).entries()) {
      tstats.ptcQuiz++;
      const Q = `${W}/q${j}`;
      const [stem, ans, ko, wr] = q;
      if ((stem.match(/（　）/g) || []).length !== 1) err(Q, `need exactly one blank: ${stem}`);
      checkJp(Q, stem);
      if (!ans || !ko) err(Q, 'missing answer/translation');
      const ws = String(wr || '').split(',').filter(Boolean);
      if (ws.length !== 3) err(Q, `need 3 distractors: ${wr}`);
      if (ws.includes(ans) || new Set(ws).size !== ws.length) err(Q, `distractor clash: ${ans} / ${wr}`);
    }
    if ((P.q || []).length < 2) warn(W, 'fewer than 2 quizzes');
  }
  const ids = new Set();
  for (const T of D.compare || []) {
    tstats.compare++;
    const W = `compare/${T.id}`;
    if (ids.has(T.id)) err(W, 'duplicate id');
    ids.add(T.id);
    if (!T.t || !T.sum || !T.rows?.length || !T.ex?.length || !T.q?.length) err(W, 'missing fields');
    for (const [j, e] of (T.ex || []).entries()) checkJp(`${W}/ex${j}`, e[0]);
    for (const [j, q] of (T.q || []).entries()) {
      tstats.cmpQuiz++;
      const Q = `${W}/q${j}`;
      const [stem, opts, ans, expl] = q;
      if ((stem.match(/（　）/g) || []).length !== 1) err(Q, `need exactly one blank: ${stem}`);
      checkJp(Q, stem);
      if (!Array.isArray(opts) || opts.length !== 4 || new Set(opts).size !== 4) err(Q, `need 4 distinct options: ${opts}`);
      else opts.forEach((o, k) => checkJp(`${Q}/opt${k}`, o));
      if (!(ans >= 0 && ans < 4)) err(Q, 'answer out of range');
      if (!expl) err(Q, 'missing explanation');
    }
    for (const [j, p] of (T.pairs || []).entries()) if (p.length !== 3) err(`${W}/pair${j}`, 'pair needs 3 columns');
  }
  const pseen = new Set();
  for (const sit of D.phrases || []) {
    tstats.situations++;
    const W = `phrases/${sit.id}`;
    if (!sit.id || !sit.t || !sit.icon || !sit.p?.length) err(W, 'missing fields');
    for (const [j, p] of (sit.p || []).entries()) {
      tstats.phrases++;
      checkJp(`${W}/${j}`, p[0], { requireRuby: true });
      if (!p[1]) err(`${W}/${j}`, 'missing translation');
      if (pseen.has(p[0])) warn(`${W}/${j}`, `duplicate phrase ${p[0]}`);
      pseen.add(p[0]);
    }
  }
}

const total = Object.values(stats).reduce((a, s) => { for (const k in s) a[k] = (a[k] || 0) + s[k]; return a; }, {});
console.table({ ...stats, TOTAL: total });
console.table(tstats);
if (warns.length) {
  console.log(`\n${warns.length} warning(s):`);
  for (const w of warns.slice(0, process.env.ALLW ? 9999 : 40)) console.log('  ⚠ ' + w);
}
if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  for (const e of errors) console.log('  ✖ ' + e);
  process.exit(1);
}
console.log('\n✔ data OK');
