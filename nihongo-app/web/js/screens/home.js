/* 홈 대시보드 */
'use strict';

(function () {
  const { h, util, jp } = App;
  const S = () => App.store.state;

  function greeting() {
    const hr = new Date().getHours();
    if (hr < 5) return ['こんばんは', '늦은 밤까지 열공 중이네요 🌙'];
    if (hr < 11) return ['おはようございます', '상쾌한 아침, 오늘도 한 걸음! ☀️'];
    if (hr < 18) return ['こんにちは', '오늘의 목표를 채워 볼까요? 💪'];
    return ['こんばんは', '하루를 일본어로 마무리해요 🌆'];
  }

  function dayPick(arr, salt = 0) {
    if (!arr.length) return null;
    const seed = parseInt(util.hash(util.dayKey() + salt), 36);
    return arr[seed % arr.length];
  }

  /* 오늘의 학습 플랜: 복습 → 챌린지 → 코스 → 트레이닝 → 듣기 */
  const DAY_MOD = [
    ['lis', '🎧', '청해 트레이닝 1회', 'listen'], ['conj', '🔄', '동사 활용 트레이닝 1회', 'conj'], ['ptc', '🧷', '조사 트레이닝 1회', 'particles'],
    ['num', '🔢', '숫자·날짜 트레이닝 1회', 'numbers'], ['cmp', '⚖️', '헷갈리는 문법 1세트', 'compare'], ['adj', '🎨', '형용사 활용 트레이닝 1회', 'adj'],
    ['phr', '🗣️', '상황별 회화 연습 1회', 'phrases'],
  ];
  function planTasks() {
    const st = S();
    const d = App.game.today();
    const due = App.srs.dueIds().length;
    const node = App.path.current();
    const lastU = App.C.unitById[st.lastUnit] || App.C.levels[0].units[0];
    const mod = DAY_MOD[new Date().getDay()];
    return [
      { icon: '🔁', t: due ? `복습 카드 ${Math.min(due, 10)}장 넘기기` : '복습 카드 — 지금은 복습할 카드 없음', done: (d.reviews || 0) >= Math.min(10, due || 0) && ((d.reviews || 0) > 0 || due === 0), go: 'cards/srs/all' },
      { icon: '🎮', t: node ? `챌린지 레슨 1개 (${node.label})` : '챌린지 레슨 1개', done: (d.nodes || 0) >= 1, go: node ? 'lesson/node/' + encodeURIComponent(node.id) : 'path' },
      { icon: '📘', t: `코스 단원 공부 (${lastU.title})`, done: Object.keys(d.cu || {}).length >= 1, go: 'unit/' + lastU.id },
      { icon: mod[1], t: mod[2], done: (d.drills || 0) >= 1, go: mod[3] },
      { icon: '👂', t: `일본어 문장 10개 듣기 (${Math.min(10, d.listen || 0)}/10)`, done: (d.listen || 0) >= 10, go: 'listen' },
    ];
  }
  function planCard() {
    const st = S();
    const tasks = planTasks();
    const doneN = tasks.filter((t) => t.done).length;
    const key = util.dayKey();
    if (doneN === tasks.length && !st.plan[key]) {
      st.plan[key] = true;
      st.gems += 15;
      App.store.save();
      setTimeout(() => App.ui.celebrate('📋 오늘의 플랜 완료!', '모든 계획을 해냈어요. 보상으로 💎 15개!'), 300);
    }
    return h('div.plan-card',
      h('div.pc-head', h('b', '📋 오늘의 학습 플랜'), h('span.small', `${doneN} / ${tasks.length}${st.plan[key] ? ' · 💎 받음' : ' · 완료 시 💎15'}`)),
      App.ui.bar(doneN / tasks.length, 'plan-bar'),
      h('div.plan-list', tasks.map((t) => h('button.plan-item' + (t.done ? '.done' : ''), { type: 'button', onclick: () => App.go(t.go) },
        h('span.pi-check', t.done ? '✅' : '⬜'), h('span.pi-i', { lang: 'ja' }, t.icon), h('span.pi-t', t.t), h('span.mi-go', '›')))));
  }

  App.screens.home = function () {
    const st = S();
    const el = h('div.pad.home');
    const today = App.game.today();
    const [g1, g2] = greeting();

    // 인사 + 목표 링
    const goalPct = today.xp / st.profile.goalXp;
    el.appendChild(h('div.hello-card',
      h('div.hc-left',
        h('div.hc-jp', { lang: 'ja' }, g1 + '、'),
        h('div.hc-name', `${st.profile.avatar} ${st.profile.name}님`),
        h('div.hc-sub', g2),
        h('div.hc-stats',
          h('span', `🔥 ${st.streak.count}일 연속`),
          h('span', `⏱ ${util.fmtMin(today.sec)}`),
          h('span', `⚡ ${today.xp} XP`))),
      h('button.hc-ring', { type: 'button', onclick: () => App.go('stats') },
        App.ui.ring(goalPct, 86, 9, goalPct >= 1 ? `<b>🎯</b><small>목표 달성!</small>` : `<b>${Math.round(goalPct * 100)}%</b><small>오늘 목표</small>`))));

    // JLPT D-day
    if (st.profile.examDate) {
      const d = App.util.daysBetween(util.dayKey(), st.profile.examDate);
      if (d >= 0) el.appendChild(h('div.dday', h('span', `📅 JLPT ${(st.profile.target || '').toUpperCase()}`), h('b', d === 0 ? 'D-DAY!' : `D-${d}`)));
    }

    // 오늘의 학습 플랜
    el.appendChild(planCard());

    // 두 가지 학습 과정
    const lastU = App.C.unitById[st.lastUnit] || App.C.levels[0].units[0];
    const cp = App.course.unitProgress(lastU);
    const node = App.path.current();
    el.appendChild(h('div.section-title', '두 가지 학습 과정'));
    el.appendChild(h('div.track-grid',
      h('button.track.course', { type: 'button', onclick: () => App.go('unit/' + lastU.id) },
        h('div.tr-icon', '📘'),
        h('div.tr-name', '체계 코스'),
        h('div.tr-desc', '강의·예문·테스트로 깊이 있게'),
        h('div.tr-next', `${lastU.level.name} · ${lastU.title}`),
        App.ui.bar(cp.total ? cp.seen / cp.total : 0)),
      h('button.track.game', { type: 'button', onclick: () => node ? App.go('lesson/node/' + encodeURIComponent(node.id)) : App.go('path') },
        h('div.tr-icon', '🎮'),
        h('div.tr-name', '챌린지 로드'),
        h('div.tr-desc', '짧은 게임식 레슨·하트·리그'),
        h('div.tr-next', node ? `${node.unit.level.name} · ${node.label}` : '모든 레슨 완료!'),
        h('div.tr-cta', node ? '▶ 바로 시작' : '경로 보기'))));

    // 복습
    const due = App.srs.dueIds().length;
    const wrongN = Object.keys(st.wrong).length;
    el.appendChild(h('div.row.gap',
      h('button.mini-card.grow' + (due ? '.hot' : ''), { type: 'button', onclick: () => App.go('cards/srs/all') },
        h('div.mc-big', String(due)), h('div.mc-label', '오늘 복습 카드')),
      h('button.mini-card.grow', { type: 'button', onclick: () => App.go('lesson/wrong/x') },
        h('div.mc-big', String(wrongN)), h('div.mc-label', '오답 노트')),
      h('button.mini-card.grow', { type: 'button', onclick: () => App.go('focus') },
        h('div.mc-big', '🧘'), h('div.mc-label', '집중 모드'))));

    // 트레이닝 센터
    el.appendChild(h('div.section-title.row', h('span.grow', '🏋️ 트레이닝 센터'), h('button.link.small', { type: 'button', onclick: () => App.go('train') }, '전체 보기 ›')));
    const TR = [['🔄', '동사 활용', 'conj'], ['🧷', '조사', 'particles'], ['⚖️', '비교 문법', 'compare'], ['🔢', '숫자·날짜', 'numbers'], ['🎧', '청해', 'listen'], ['🗣️', '회화 표현', 'phrases']];
    el.appendChild(h('div.train-mini', TR.map(([i, t, r]) => h('button.tm', { type: 'button', onclick: () => App.go(r) }, h('span.tm-i', { lang: 'ja' }, i), h('span.tm-t', t)))));
    if (!st.placement && st.counters.lessons < 30) {
      el.appendChild(h('button.place-banner', { type: 'button', onclick: () => App.go('placement') }, h('span', '🧭'), h('div.grow', h('b', '내 레벨 진단하기'), h('div.small', '5분 테스트로 나에게 맞는 시작 레벨을 찾아요')), h('span', '›')));
    }

    // 오늘의 단어
    const tgt = App.C.levelById[st.profile.target] || App.C.levelById.n5;
    const pool = tgt && tgt._vocab.length ? tgt._vocab : App.C.all.v;
    const wod = dayPick(pool.filter((v) => App.jp.hasKanji(v.w)).length ? pool.filter((v) => App.jp.hasKanji(v.w)) : pool, 'w');
    if (wod) {
      el.appendChild(h('div.section-title', '오늘의 단어'));
      el.appendChild(h('div.wod', { onclick: () => App.views.itemSheet(wod) },
        h('div.wod-main', h('div.wod-w', { lang: 'ja' }, wod.w), h('div.wod-r', { lang: 'ja' }, wod.r !== wod.w ? wod.r : ''), h('div.wod-m', wod.m)),
        h('div.wod-tools', App.views.speakBtn(wod.r), App.views.markBtn(wod.id)),
        wod.ex ? h('div.wod-ex', { lang: 'ja', html: jp.ruby(wod.ex) + `<div class="small muted">${util.esc(wod.exKo)}</div>` }) : null));
    }

    // 오늘의 한마디
    const quote = dayPick((window.JPDATA.quotes || []), 'q');
    if (quote) {
      el.appendChild(h('div.quote', { onclick: () => App.tts.speak(quote[0]) },
        h('div.q-jp', { lang: 'ja', html: jp.ruby(quote[0]) }), h('div.q-ko', quote[1]), quote[2] ? h('div.q-note.small', quote[2]) : null));
    }

    // 리그
    const L = App.game.league();
    el.appendChild(h('button.league-mini', { type: 'button', onclick: () => App.go('league') },
      h('span.lm-tier', L.tierInfo[2]), h('div.lm-body', h('b', `${L.tierInfo[0]} 리그`), h('div.small', `이번 주 ${L.rank}위 · ${st.league.xp} XP`)), h('span', '›')));

    // 바로가기
    el.appendChild(h('div.section-title', '학습 도구'));
    const tools = [
      ['📝', 'JLPT 모의고사', 'exam'], ['📒', '단어장', 'words'], ['📑', '문법 색인', 'gindex'],
      ['🔎', '사전 검색', 'dict'], ['あ', '50음도', 'kana'], ['✍️', '쓰기 연습', 'write/あ'],
      ['🧭', '레벨 진단', 'placement'], ['📊', '학습 통계', 'stats'], ['🏆', '업적', 'ach'],
    ];
    el.appendChild(h('div.tool-grid', tools.map(([i, t, r]) => h('button.tool', { type: 'button', onclick: () => App.go(r) }, h('span.tool-i', { lang: 'ja' }, i), h('span.tool-t', t)))));
    return { el, title: '일본어 마스터', tab: 'home' };
  };
})();
