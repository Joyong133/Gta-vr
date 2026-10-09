/* 단어장(레벨별 전체 단어·셀프 테스트) · 문법 색인 */
'use strict';

(function () {
  const { h, util, jp } = App;
  const S = () => App.store.state;
  const LVS = ['n5', 'n4', 'n3', 'n2', 'n1'];

  function levelChips(cur, route) {
    return h('div.level-chips', LVS.map((id) => {
      const lv = App.C.levelById[id];
      return h('button.lchip' + (id === cur ? '.on' : ''), { type: 'button', style: { '--lv': lv.color }, onclick: () => App.go(`${route}/${id}`, true) }, lv.name);
    }));
  }

  // 임의 아이템 목록으로 퀴즈
  App.drills.ids = () => {
    const ids = App._listIds || [];
    if (!ids.length) return null;
    return { title: App._listTitle ? `${App._listTitle} 퀴즈` : '단어장 퀴즈', list: App.ex.build.fromItems(ids, 15), xp: 10 };
  };
  // 레벨 문법 퀴즈
  App.drills.gq = ([lv = 'n5', unit = '']) => {
    const L = App.C.levelById[lv];
    if (!L) return null;
    const gs = unit ? L._grammar.filter((g) => g.unit === unit) : L._grammar;
    const pairs = util.shuffle(gs.flatMap((g) => (g.q || []).map((_, i) => [g, i]))).slice(0, 15);
    return { title: `${L.name} 문법 퀴즈`, list: pairs.map(([g, i]) => App.ex.gen.grammarQuiz(g, i)).filter(Boolean), xp: 12 };
  };

  /* ───────── 단어장 ───────── */
  const wstate = { unit: '', status: 'all', sort: 'unit', hide: '', q: '' };
  App.screens.words = function ([lvId]) {
    const st = S();
    const id = LVS.includes(lvId) ? lvId : (LVS.includes(st.profile.target) ? st.profile.target : 'n5');
    const lv = App.C.levelById[id];
    const el = h('div.pad');
    el.appendChild(levelChips(id, 'words'));
    if (wstate.unit && !lv.units.some((u) => u.id === wstate.unit)) wstate.unit = '';

    const unitSel = h('select.sel', { onchange: (e) => { wstate.unit = e.target.value; run(); } },
      h('option', { value: '' }, `전체 단원 (${lv._vocab.length}개)`),
      lv.units.filter((u) => u._vocab.length).map((u) => h('option', { value: u.id, selected: wstate.unit === u.id }, `${u.index + 1}. ${u.title} (${u._vocab.length})`)));
    const input = h('input.search', { type: 'search', placeholder: '이 레벨에서 검색', value: wstate.q, autocomplete: 'off' });
    const segBtn = (key, val, label) => h('button.seg-btn' + (wstate[key] === val ? '.on' : ''), { type: 'button', onclick: (e) => {
      wstate[key] = wstate[key] === val && key === 'hide' ? '' : val;
      App.$$('.seg-btn', e.target.parentNode).forEach((b) => b.classList.remove('on'));
      if (wstate[key] === val) e.target.classList.add('on');
      run();
    } }, label);
    const statusSeg = h('div.seg', segBtn('status', 'all', '전체'), segBtn('status', 'new', '미학습'), segBtn('status', 'learn', '학습함'), segBtn('status', 'mark', '★'), segBtn('status', 'wrong', '오답'));
    const hideSeg = h('div.seg', segBtn('hide', 'mean', '🙈 뜻 가리기'), segBtn('hide', 'word', '🙈 단어 가리기'));
    const sortSeg = h('div.seg', segBtn('sort', 'unit', '단원순'), segBtn('sort', 'kana', 'あいう순'), segBtn('sort', 'rand', '랜덤'));
    const info = h('div.small.muted.wl-info');
    const listEl = h('div.word-list');
    const actions = h('div.row.gap.wrap',
      h('button.btn.primary.grow', { type: 'button', onclick: () => { if (!App._listIds || !App._listIds.length) return App.ui.toast('목록이 비어 있어요'); App.go('lesson/drill/ids'); } }, '▶ 이 목록 퀴즈'),
      h('button.btn.ghost.grow', { type: 'button', onclick: () => { if (!App._listIds || !App._listIds.length) return App.ui.toast('목록이 비어 있어요'); App.go('cards/list/x'); } }, '🃏 카드로 학습'),
      h('button.btn.ghost.grow', { type: 'button', onclick: () => { const ids = App._listIds || []; App.srs.addMany(ids, 0); App.ui.toast(`${ids.length}개를 복습 카드에 추가했어요`); App.ui.refreshTop(); } }, '🔁 복습 추가'));

    function run() {
      wstate.q = input.value;
      const q = input.value.trim();
      const hq = jp.toHira(q);
      let vs = wstate.unit ? (App.C.unitById[wstate.unit] || {})._vocab || [] : lv._vocab;
      if (q) vs = vs.filter((v) => v.w.includes(q) || v.r.includes(hq) || v.m.includes(q));
      if (wstate.status === 'new') vs = vs.filter((v) => !App.srs.has(v.id));
      else if (wstate.status === 'learn') vs = vs.filter((v) => App.srs.has(v.id));
      else if (wstate.status === 'mark') vs = vs.filter((v) => st.marks[v.id]);
      else if (wstate.status === 'wrong') vs = vs.filter((v) => st.wrong[v.id]);
      if (wstate.sort === 'kana') vs = vs.slice().sort((a, b) => jp.toHira(a.r).localeCompare(jp.toHira(b.r), 'ja'));
      else if (wstate.sort === 'rand') vs = util.shuffle(vs);
      App._listIds = vs.map((v) => v.id);
      App._listTitle = `${lv.name} 단어장`;
      const learned = vs.filter((v) => App.srs.has(v.id)).length;
      info.textContent = `${vs.length}개 · 학습함 ${learned} · 줄을 누르면 예문, 가린 부분은 눌러서 확인`;
      listEl.className = 'word-list' + (wstate.hide === 'mean' ? ' hide-mean' : wstate.hide === 'word' ? ' hide-word' : '');
      listEl.innerHTML = '';
      let shown = 0;
      const more = () => {
        const chunk = vs.slice(shown, shown + 120);
        chunk.forEach((v) => listEl.appendChild(App.views.vocabRow(v, { showUnit: !wstate.unit })));
        shown += chunk.length;
        if (shown < vs.length) listEl.appendChild(h('button.btn.ghost.block.more-btn', { type: 'button', onclick: (e) => { e.target.remove(); more(); } }, `더 보기 (${vs.length - shown}개 남음)`));
      };
      if (!vs.length) listEl.appendChild(App.ui.empty('🗂️', '조건에 맞는 단어가 없어요.'));
      else more();
    }
    input.addEventListener('input', util.debounce(run, 150));
    el.append(unitSel, input, statusSeg, hideSeg, sortSeg, actions, info, listEl);
    run();
    return { el, title: `${lv.name} 단어장`, back: true, tab: 'home', study: true };
  };

  /* ───────── 문법 색인 ───────── */
  App.screens.gindex = function ([lvId]) {
    const st = S();
    const id = LVS.includes(lvId) ? lvId : (LVS.includes(st.profile.target) ? st.profile.target : 'n5');
    const lv = App.C.levelById[id];
    const el = h('div.pad');
    el.appendChild(levelChips(id, 'gindex'));
    const seen = lv._grammar.filter((g) => st.viewed[g.id]).length;
    el.appendChild(h('div.row.gap.wrap',
      h('button.btn.primary.grow', { type: 'button', onclick: () => App.go('lesson/drill/gq/' + id) }, `▶ ${lv.name} 문법 퀴즈`),
      h('button.btn.ghost.grow', { type: 'button', onclick: () => App.go('compare') }, '⚖️ 헷갈리는 문법')));
    el.appendChild(h('div.small.muted', `문법 ${lv._grammar.length}개 · 읽은 문법 ${seen}개 — 카드를 누르면 설명·예문·확인 문제가 열려요.`));
    const input = h('input.search', { type: 'search', placeholder: '문법 검색 (예: ながら, ~하면서)', autocomplete: 'off' });
    const box = h('div');
    const run = () => {
      const q = input.value.trim();
      box.innerHTML = '';
      for (const u of lv.units) {
        let gs = u._grammar;
        if (q) gs = gs.filter((g) => jp.plain(g.p).includes(q) || jp.kana(g.p).includes(jp.toHira(q)) || g.m.includes(q) || (g.e || '').includes(q));
        if (!gs.length) continue;
        box.appendChild(h('div.gi-unit', h('span', `${u.index + 1}. ${u.title}`), h('button.link.small', { type: 'button', onclick: () => App.go('unit/' + u.id) }, '단원으로 ›')));
        gs.forEach((g) => box.appendChild(App.views.grammarCard(g)));
      }
      if (!box.childElementCount) box.appendChild(App.ui.empty('🔎', '검색 결과가 없어요.'));
    };
    input.addEventListener('input', util.debounce(run, 150));
    el.append(input, box);
    run();
    return { el, title: `${lv.name} 문법 색인`, back: true, tab: 'home', study: true };
  };
})();
