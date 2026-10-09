/* 학습 콘텐츠 색인: 레벨·단원·아이템(단어/한자/문법/문장/가나) */
'use strict';

App.C = (function () {
  const LEVEL_ORDER = ['kana', 'n5', 'n4', 'n3', 'n2', 'n1'];
  const D = window.JPDATA || { levels: [] };
  const levels = LEVEL_ORDER.map((id) => D.levels.find((l) => l.id === id)).filter(Boolean);
  const items = {};
  const unitById = {};
  const all = { v: [], k: [], g: [], s: [], a: [] };

  const add = (it) => {
    if (items[it.id]) return items[it.id];
    items[it.id] = it;
    all[it.t].push(it);
    return it;
  };

  // 가나 아이템
  const kanaGroups = {};
  const K = D.kana || {};
  for (const key of Object.keys(K)) {
    kanaGroups[key] = (K[key] || []).map((row) => ({
      row: row.row,
      chars: row.chars.map((c) => add({
        t: 'a', id: 'a:' + c[0], c: c[0], ro: c[1], ko: c[2], origin: c[3] || '', tip: c[4] || '',
        script: key.startsWith('kata') ? 'kata' : 'hira', group: key, lv: 'kana',
      })),
    }));
  }

  for (const lv of levels) {
    lv._vocab = []; lv._kanji = []; lv._grammar = []; lv._sent = []; lv._reading = []; lv._kana = [];
    lv.units.forEach((u, ui) => {
      u.lv = lv.id; u.index = ui; u.level = lv;
      unitById[u.id] = u;
      u._vocab = (u.vocab || []).map((v) => {
        const r = v[1] || v[0];
        const it = add({ t: 'v', id: 'v:' + v[0] + '|' + r, w: v[0], r, m: v[2], ex: v[3] || '', exKo: v[4] || '', lv: lv.id, unit: u.id });
        return it;
      });
      u._kanji = (u.kanji || []).map((k) => add({
        t: 'k', id: 'k:' + k[0], c: k[0], on: k[1], kun: k[2], ko: k[3],
        words: k[4].split(/,\s*/).map((p) => { const [w, m] = p.split(':'); return { w, m }; }),
        lv: lv.id, unit: u.id,
      }));
      u._grammar = (u.grammar || []).map((g) => add(Object.assign({ t: 'g', lv: lv.id, unit: u.id }, g)));
      const sents = [];
      for (const g of u._grammar) for (const ex of g.ex || []) sents.push({ jp: ex[0], ko: ex[1], src: g.id });
      for (const v of u._vocab) if (v.ex) sents.push({ jp: v.ex, ko: v.exKo, src: v.id });
      for (const t of u.talk || []) sents.push({ jp: t[1], ko: t[2], src: 'talk', who: t[0] });
      u._sent = sents.map((s) => add(Object.assign({ t: 's', id: 's:' + App.util.hash(s.jp), lv: lv.id, unit: u.id }, s)));
      u._kana = [];
      for (const spec of [u.kana, u.extraKana]) {
        if (!spec) continue;
        const [group, rows] = spec;
        for (const r of rows) {
          const row = (kanaGroups[group] || [])[r];
          if (row) u._kana.push(...row.chars);
        }
      }
      u._reading = u.reading || [];
      lv._vocab.push(...u._vocab); lv._kanji.push(...u._kanji); lv._grammar.push(...u._grammar);
      lv._sent.push(...u._sent); lv._reading.push(...u._reading.map((r) => Object.assign({ unit: u.id }, r)));
      lv._kana.push(...u._kana);
    });
  }

  const levelById = Object.fromEntries(levels.map((l) => [l.id, l]));

  function search(q) {
    q = String(q || '').trim();
    if (!q) return [];
    const ql = q.toLowerCase();
    const hira = App.jp.toHira(q);
    const res = [];
    const score = (hay, w) => {
      if (!hay) return 0;
      const h = String(hay).toLowerCase();
      if (h === ql || h === hira) return 100 * w;
      if (h.startsWith(ql) || h.startsWith(hira)) return 60 * w;
      if (h.includes(ql) || h.includes(hira)) return 30 * w;
      return 0;
    };
    for (const it of all.v) {
      const s = Math.max(score(it.w, 1.2), score(it.r, 1.1), score(it.m, 1));
      if (s) res.push([s, it]);
    }
    for (const it of all.k) {
      const s = Math.max(score(it.c, 1.3), score(it.ko, 1), score(it.on, 0.8), score(it.kun, 0.8));
      if (s) res.push([s, it]);
    }
    for (const it of all.g) {
      const s = Math.max(score(App.jp.plain(it.p), 1.1), score(it.m, 0.9), score(App.jp.kana(it.p), 1));
      if (s) res.push([s, it]);
    }
    for (const it of all.a) {
      const s = Math.max(score(it.c, 1.2), score(it.ro, 0.7));
      if (s) res.push([s, it]);
    }
    res.sort((a, b) => b[0] - a[0]);
    return res.slice(0, 80).map((x) => x[1]);
  }

  function nextUnit(u) {
    const lv = levelById[u.lv];
    if (u.index + 1 < lv.units.length) return lv.units[u.index + 1];
    const li = levels.indexOf(lv);
    return levels[li + 1] ? levels[li + 1].units[0] : null;
  }

  return { levels, levelById, unitById, items, all, kanaGroups, search, nextUnit, LEVEL_ORDER };
})();
