/* 레벨 진단 테스트: N5부터 레벨별 5문제, 3개 이상 맞히면 다음 레벨로 */
'use strict';

(function () {
  const { h, util } = App;
  const S = () => App.store.state;
  const ORDER = ['n5', 'n4', 'n3', 'n2', 'n1'];
  const PER = 5, PASS = 3;

  function block(lvId) {
    const L = App.C.levelById[lvId];
    const G = App.ex.gen;
    const out = [];
    const vk = util.shuffle(L._vocab.filter((v) => App.jp.hasKanji(v.w)));
    if (vk[0]) out.push(G.vocabReading(vk[0], L._vocab) || G.vocabMeaning(vk[0], L._vocab));
    if (vk[1]) out.push(G.vocabMeaning(vk[1], L._vocab));
    const gq = util.shuffle(L._grammar.flatMap((g) => (g.q || []).map((_, i) => [g, i])));
    for (const [g, i] of gq.slice(0, 2)) out.push(G.grammarQuiz(g, i));
    const k = util.pick(L._kanji);
    if (k) out.push(G.kanjiWord(k, L._kanji) || G.kanjiMeaning(k, L._kanji));
    while (out.filter(Boolean).length < PER && vk.length > 2) out.push(G.vocabWord(vk.pop(), L._vocab));
    return util.shuffle(out.filter(Boolean)).slice(0, PER).map((e) => Object.assign(e, { lv: lvId }));
  }

  App.screens.placement = function () {
    const wrap = h('div.lesson.placement');
    const scr = { el: wrap, full: true, study: true };
    const mount = h('div.ex-mount');
    const progress = App.ui.bar(0, 'lesson-bar');
    const lvTag = h('div.combo');
    const head = h('div.lesson-head', h('button.icon-btn', { type: 'button', 'aria-label': '나가기', onclick: () => App.back() }, '✕'), progress, lvTag);
    const checkBtn = h('button.btn.primary.block.check', { type: 'button', disabled: true }, '확인');
    const skipBtn = h('button.btn.ghost.skip', { type: 'button' }, '모르겠어요');
    const foot = h('div.lesson-foot', h('div.foot-row', skipBtn, checkBtn));
    wrap.append(head, h('div.lesson-body', mount), foot);

    const st = { li: 0, q: [], qi: 0, answer: null, phase: 'answer', scores: {}, start: Date.now() };
    const ctx = { setAnswer(v) { st.answer = v; checkBtn.disabled = v == null; }, submit() { check(); }, complete() {}, cantListen() {}, cantSpeak() {} };

    function intro() {
      foot.style.display = 'none';
      head.style.visibility = 'hidden';
      const last = S().placement;
      mount.innerHTML = '';
      mount.append(h('div.result',
        h('div.result-title', '🧭 레벨 진단'),
        h('p.center', 'N5부터 시작해서 레벨마다 5문제(단어·문법·한자)를 풀어요.'),
        h('p.center.muted.small', `${PASS}문제 이상 맞히면 다음 레벨로 올라가고, 그렇지 않으면 그 레벨에서 멈춰요. 약 3~8분 걸려요.`),
        last ? h('p.center.small', `지난 진단 (${new Date(last.date).toLocaleDateString('ko-KR')}): 추천 ${last.rec.toUpperCase()}`) : null,
        h('div.col.gap',
          h('button.btn.primary.block.big', { type: 'button', onclick: () => { head.style.visibility = ''; foot.style.display = ''; nextBlock(); } }, '진단 시작'),
          h('button.btn.ghost.block', { type: 'button', onclick: () => App.back() }, '나중에 할게요')),
        h('p.small.muted.center', '히라가나·가타카나를 아직 모른다면 진단 없이 「문자」 레벨부터 시작하는 것을 추천해요.')));
    }

    function nextBlock() {
      const lvId = ORDER[st.li];
      st.q = block(lvId);
      st.qi = 0;
      st.scores[lvId] = 0;
      lvTag.textContent = App.C.levelById[lvId].name;
      render();
    }

    function render() {
      st.answer = null;
      st.phase = 'answer';
      checkBtn.disabled = true;
      checkBtn.textContent = '확인';
      skipBtn.style.display = '';
      const done = st.li * PER + st.qi;
      progress.firstChild.style.width = Math.round((done / (ORDER.length * PER)) * 100) + '%';
      const ex = st.q[st.qi];
      App.ex.render(ex, mount, ctx);
    }

    function check(skip = false) {
      if (st.phase !== 'answer') { advance(); return; }
      const ex = st.q[st.qi];
      const { ok } = App.ex.check(ex, skip ? '__skip__' : st.answer);
      if (ok) { st.scores[ex.lv]++; App.sfx.good(); } else App.sfx.bad();
      App.game.recordAnswer(ok);
      st.phase = 'shown';
      checkBtn.disabled = false;
      checkBtn.textContent = '다음';
      skipBtn.style.display = 'none';
    }

    function advance() {
      st.qi++;
      if (st.qi < st.q.length) return render();
      const lvId = ORDER[st.li];
      if (st.scores[lvId] >= PASS && st.li < ORDER.length - 1) { st.li++; App.ui.toast(`✅ ${App.C.levelById[lvId].name} 통과! 다음 레벨로`); return nextBlock(); }
      finish();
    }

    function finish() {
      const passed = ORDER.filter((l) => st.scores[l] >= PASS);
      const failAt = ORDER.find((l) => st.scores[l] != null && st.scores[l] < PASS);
      const rec = failAt || 'n1';
      const res = { date: Date.now(), rec, scores: st.scores, passed };
      S().placement = res;
      App.game.addXp(10, 'placement');
      App.store.save();
      App.sfx.done();
      foot.style.display = 'none';
      head.style.visibility = 'hidden';
      mount.innerHTML = '';
      const recLv = App.C.levelById[rec];
      mount.append(h('div.result',
        h('div.result-title', '🧭 진단 결과'),
        h('div.place-rec', { style: { '--lv': recLv.color } }, h('small', '추천 학습 레벨'), h('b', recLv.name), h('span', recLv.title)),
        h('p.center.small', !failAt ? '모든 레벨을 통과했어요! N1 심화 학습과 JLPT 모의고사로 실전 감각을 다듬어 보세요.'
          : passed.length ? `${passed.map((l) => l.toUpperCase()).join(' · ')} 레벨은 이미 기본기가 있어요. ${recLv.name}부터 집중하면 효율이 가장 좋아요!` : 'N5부터 차근차근 시작해요. 기초를 탄탄히 하면 금방 올라가요!'),
        h('div.place-bars', ORDER.map((l) => st.scores[l] == null ? null : h('div.lp-row', h('span', l.toUpperCase()), App.ui.bar(st.scores[l] / PER, st.scores[l] >= PASS ? '' : 'bad'), h('span.small', `${st.scores[l]}/${PER}`)))),
        h('div.col.gap',
          h('button.btn.primary.block', { type: 'button', onclick: () => applyRec(rec) }, `${recLv.name}부터 시작하기`),
          h('button.btn.ghost.block', { type: 'button', onclick: () => App.go('placement', true) }, '다시 진단하기'),
          h('button.btn.ghost.block', { type: 'button', onclick: () => App.leave() }, '닫기')),
        h('p.small.muted.center', '「시작하기」를 누르면 챌린지 로드에서 이 레벨까지 바로 열리고, 목표 레벨도 맞춰져요. 이전 레벨도 언제든 복습할 수 있어요.')));
      scr.onBack = null;
    }

    function applyRec(rec) {
      const P = S().profile;
      P.start = rec;
      if (ORDER.indexOf(P.target) < ORDER.indexOf(rec)) P.target = rec;
      const L = App.C.levelById[rec];
      S().lastUnit = L.units[0].id;
      App.store.save();
      App.ui.toast(`${L.name} 레벨을 열었어요!`);
      scr.onBack = null;
      App.go('level/' + rec, true);
    }

    checkBtn.addEventListener('click', () => check());
    skipBtn.addEventListener('click', () => check(true));
    scr.onMount = intro;
    scr.onBack = () => {
      if (head.style.visibility === 'hidden') { scr.onBack = null; App.back(); return; }
      App.ui.confirm('진단을 그만둘까요?', { ok: '그만두기', cancel: '계속', danger: true }).then((y) => { if (y) App.leave(); });
    };
    return scr;
  };
})();
