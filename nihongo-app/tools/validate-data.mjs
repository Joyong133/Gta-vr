// 학습 데이터 무결성 검사: node nihongo-app/tools/validate-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'web', 'data');
const order = ['kana.js', 'n5.js', 'n4.js', 'n3.js', 'n2.js', 'n1.js', 'vocab-plus.js', 'extra.js'];

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

const total = Object.values(stats).reduce((a, s) => { for (const k in s) a[k] = (a[k] || 0) + s[k]; return a; }, {});
console.table({ ...stats, TOTAL: total });
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
