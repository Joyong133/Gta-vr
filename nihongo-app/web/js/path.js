/* 챌린지 로드(게임식 학습) — 단원별 노드 구성, 잠금 해제 규칙, 레슨 생성 */
'use strict';

App.path = (function () {
  const { util } = App;
  const cache = {};
  const chunk = (arr, n) => {
    if (!arr.length) return [];
    const k = Math.max(1, Math.round(arr.length / Math.ceil(arr.length / n)));
    const out = [];
    for (let i = 0; i < arr.length; i += k) out.push(arr.slice(i, i + k));
    // 마지막 묶음이 너무 작으면 앞 묶음에 합침
    if (out.length > 1 && out[out.length - 1].length < Math.ceil(k / 2)) out[out.length - 2].push(...out.pop());
    return out;
  };

  function nodesOf(u) {
    if (cache[u.id]) return cache[u.id];
    const nodes = [];
    const add = (type, idx, label, icon, data, xp = 10) => nodes.push({ id: `${u.id}:${type}${idx}`, unit: u, type, label, icon, data, xp });
    if (!u._kana.length && !u._vocab.length && !u._grammar.length && (u.lessons || []).length) {
      add('guide', 0, '가이드 읽기', '📖', u.lessons, 5);
      cache[u.id] = nodes;
      return nodes;
    }
    if ((u.lessons || []).length && u.lv === 'kana') add('guide', 0, '발음 가이드', '📖', u.lessons, 5);
    if (u._kana.length) {
      const specs = [u.kana, u.extraKana].filter(Boolean);
      let i = 0;
      for (const [group, rows] of specs) for (const r of rows) {
        const row = (App.C.kanaGroups[group] || [])[r];
        if (!row) continue;
        add('kana', i++, row.row, row.chars[0].c, row.chars);
      }
      if (u._vocab.length) add('words', 0, '낱말 읽기', '🔤', u._vocab);
      add('review', 0, '유닛 보스', '🏆', u, 15);
      cache[u.id] = nodes;
      return nodes;
    }
    const V = chunk(u._vocab, 9);
    const G = chunk(u._grammar, 3);
    const K = chunk(u._kanji, 6);
    let vi = 0, gi = 0, ki = 0;
    const pattern = ['v', 'v', 'g', 'k', 'v', 'g', 'v', 'k', 'g', 'v', 'g', 'v', 'k', 'v', 'g'];
    let guard = 0;
    while ((vi < V.length || gi < G.length || ki < K.length) && guard++ < 200) {
      for (const p of pattern) {
        if (p === 'v' && vi < V.length) { add('vocab', vi, `단어 ${vi + 1}`, '🗂️', V[vi]); vi++; }
        else if (p === 'g' && gi < G.length) { add('grammar', gi, `문법 ${gi + 1}`, '🧩', G[gi]); gi++; }
        else if (p === 'k' && ki < K.length) { add('kanji', ki, `한자 ${ki + 1}`, '漢', K[ki]); ki++; }
      }
    }
    const talkS = u._sent.filter((s) => s.src === 'talk');
    if (talkS.length >= 3) add('talk', 0, '회화 듣기', '💬', talkS);
    else if (u._sent.length >= 4) add('talk', 0, '문장 연습', '💬', util.sample(u._sent, 8));
    (u.reading || []).forEach((r, i) => add('read', i, `이야기 ${i + 1}`, '📰', r, 12));
    add('review', 0, '유닛 보스', '🏆', u, 15);
    cache[u.id] = nodes;
    return nodes;
  }

  function levelNodes(lv) { return lv.units.flatMap((u) => nodesOf(u)); }

  function levelOpen(lv) {
    const S = App.store.state;
    const L = App.C.levels;
    const i = L.indexOf(lv);
    if (i <= 1) return true; // 문자, N5 항상 열림
    const startIdx = App.C.LEVEL_ORDER.indexOf(S.profile.start || 'kana');
    if (App.C.LEVEL_ORDER.indexOf(lv.id) <= startIdx) return true;
    if (S.skipped[lv.id]) return true;
    const prev = L[i - 1];
    return S.skipped[prev.id] || App.game.levelDone(prev.id) || levelNodes(prev).every((n) => done(n));
  }

  function done(n) { return ((App.store.state.path[n.id] || {}).n || 0) > 0; }

  function status(n) {
    if (done(n)) return 'done';
    const S = App.store.state;
    const lv = n.unit.level;
    if (!levelOpen(lv)) return 'locked';
    if (S.skipped[lv.id]) return 'open';
    const list = levelNodes(lv);
    const i = list.indexOf(n);
    if (i === 0 || done(list[i - 1])) return 'open';
    return 'locked';
  }

  function current() {
    for (const lv of App.C.levels) {
      if (!levelOpen(lv)) continue;
      for (const n of levelNodes(lv)) if (status(n) === 'open') return n;
    }
    return null;
  }

  function byId(id) {
    const unitId = id.split(':')[0];
    const u = App.C.unitById[unitId];
    if (!u) return null;
    return nodesOf(u).find((n) => n.id === id) || null;
  }

  function exercises(n) {
    const B = App.ex.build;
    const u = n.unit;
    switch (n.type) {
      case 'kana': return B.kana(n.data, u);
      case 'words': return util.sample(n.data, 10).map((v) => util.pick([App.ex.gen.vocabMeaning, App.ex.gen.vocabListen, App.ex.gen.vocabWord])(v, u._vocab.length > 4 ? u._vocab : App.C.all.v) || App.ex.gen.vocabMeaning(v, u._vocab)).concat([App.ex.gen.match(util.sample(n.data, 5))]).filter(Boolean);
      case 'vocab': return B.vocab(n.data, u);
      case 'kanji': return B.kanji(n.data, u);
      case 'grammar': return B.grammar(n.data, u);
      case 'talk': return B.sentences(n.data, u);
      case 'review': return B.review(u);
      default: return [];
    }
  }

  // 레슨 완료 시 SRS에 등록할 아이템
  function itemsOf(n) {
    switch (n.type) {
      case 'kana': return n.data.map((a) => a.id);
      case 'words': case 'vocab': return n.data.map((v) => v.id);
      case 'kanji': return n.data.map((k) => k.id);
      case 'grammar': return n.data.map((g) => g.id);
      case 'talk': return n.data.map((s) => s.id);
      default: return [];
    }
  }

  return { nodesOf, levelNodes, levelOpen, status, done, current, byId, exercises, itemsOf };
})();
