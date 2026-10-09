/* 트레이닝 센터: 집중 연습 모듈 레지스트리, 기록, 허브 화면 */
'use strict';

// lesson/drill/<모듈>/<인자…> 로 실행되는 연습 생성기 모음
App.drills = App.drills || {};

App.train = (function () {
  const { h, util } = App;
  const S = () => App.store.state;

  function rec(key) { return (S().train || {})[key] || null; }

  function record(key, acc) {
    const st = S();
    st.train = st.train || {};
    const r = (st.train[key] = st.train[key] || { n: 0, best: 0 });
    r.n++;
    r.best = Math.max(r.best, acc);
    r.ts = Date.now();
    st.counters.drills = (st.counters.drills || 0) + 1;
    const d = App.game.today();
    d.drills = (d.drills || 0) + 1;
    App.store.save();
  }

  // 모듈 접두사별 누적 횟수
  function count(prefixes) {
    const ps = prefixes.split('|');
    return Object.entries(S().train || {}).filter(([k]) => ps.some((p) => k === p || k.startsWith(p + '/'))).reduce((a, [, r]) => a + (r.n || 0), 0);
  }

  const MODULES = [
    ['conj|vgroup|conjv', '🔄', '동사 활용', 'ます·て·ない·가능·수동·사역까지 22가지 활용형', 'conj'],
    ['adj|atype', '🎨', '형용사 활용', 'い·な형용사 부정·과거·て형·そう', 'adj'],
    ['ptc', '🧷', '조사 마스터', 'は·が·を·に·で… 용법별 정리와 빈칸 연습', 'particles'],
    ['cmp', '⚖️', '헷갈리는 문법', '비슷한 표현 비교 (は/が, たら/ば/と/なら…)', 'compare'],
    ['num', '🔢', '숫자·시간·날짜', '숫자 읽기, 시각, 날짜, 조수사', 'numbers'],
    ['phr', '🗣️', '상황별 회화', '식당·쇼핑·길 묻기 등 실전 표현', 'phrases'],
    ['lis', '🎧', '청해 트레이닝', '받아쓰기·듣고 뜻 고르기·쉐도잉·연속 듣기', 'listen'],
    ['words', '📒', '단어장', '레벨별 전체 단어, 가리기 셀프 테스트', 'words'],
    ['gidx', '📑', '문법 색인', '레벨별 전체 문법 한눈에 보기', 'gindex'],
    ['place', '🧭', '레벨 진단', '내 실력에 맞는 시작 레벨 찾기', 'placement'],
  ];

  function hub() {
    const el = h('div.pad');
    el.appendChild(h('div.train-hero',
      h('div.th-icon', '🏋️'),
      h('div.th-body', h('div.th-title', '트레이닝 센터'), h('div.th-desc', '코스와 챌린지에서 배운 내용을 영역별로 집중 훈련해요. 약한 부분만 골라 반복하면 실력이 빠르게 올라가요.'))));
    const st = S();
    el.appendChild(h('div.th-stats.small.muted', `누적 트레이닝 ${st.counters.drills || 0}회 · 오늘 ${(App.game.today().drills || 0)}회`));
    const grid = h('div.train-grid');
    for (const [key, icon, title, desc, route] of MODULES) {
      const n = count(key);
      grid.appendChild(h('button.train-card', { type: 'button', onclick: () => App.go(route) },
        h('div.tc-i', { lang: 'ja' }, icon), h('div.tc-t', title), h('div.tc-d', desc), n ? h('div.tc-n', `${n}회 연습`) : null));
    }
    el.appendChild(grid);
    return { el, title: '트레이닝 센터', back: true, tab: 'home' };
  }

  /* 공용 UI 조각 */
  function levelSeg(levels, cur, onPick) {
    const seg = h('div.seg');
    for (const [id, label] of levels) {
      seg.appendChild(h('button.seg-btn' + (id === cur ? '.on' : ''), { type: 'button', onclick: () => onPick(id) }, label));
    }
    return seg;
  }

  function startRow(label, sub, route, icon = '▶') {
    const r = rec(route.replace(/^lesson\/drill\//, ''));
    return h('button.menu-item', { type: 'button', onclick: () => App.go(route) },
      h('span.mi-i', { lang: 'ja' }, icon),
      h('div.mi-b', h('div.mi-t', label), h('div.mi-d', sub + (r ? ` · 최고 ${r.best}% · ${r.n}회` : ''))),
      h('span.mi-go', '›'));
  }

  function hero(icon, title, desc) {
    return h('div.train-hero', h('div.th-icon', { lang: 'ja' }, icon), h('div.th-body', h('div.th-title', title), h('div.th-desc', desc)));
  }

  // 펼침 카드
  function fold(head, fillBody, { open = false } = {}) {
    const card = h('div.gcard' + (open ? '.open' : ''));
    const hd = h('div.g-head', head, h('div.g-tools', h('span.chev', '⌄')));
    const body = h('div.g-body');
    const fill = () => { if (!body.childElementCount) fillBody(body); };
    if (open) fill();
    hd.addEventListener('click', () => { card.classList.toggle('open'); if (card.classList.contains('open')) fill(); });
    card.append(hd, body);
    return card;
  }

  return { rec, record, count, MODULES, hub, levelSeg, startRow, hero, fold };
})();

App.screens = App.screens || {};
App.screens.train = () => App.train.hub();
