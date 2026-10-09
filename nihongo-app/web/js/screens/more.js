/* 더보기 메뉴, 사전, 통계, 업적, 리그, 상점 */
'use strict';

(function () {
  const { h, util, jp } = App;
  const S = () => App.store.state;

  /* ───────── 더보기 ───────── */
  App.screens.more = function () {
    const st = S();
    const el = h('div.pad');
    el.appendChild(h('button.profile-card', { type: 'button', onclick: () => App.go('settings') },
      h('div.pc-avatar', st.profile.avatar), h('div.pc-body', h('div.pc-name', st.profile.name), h('div.small.muted', `총 ${st.xp.toLocaleString()} XP · 최고 연속 ${st.streak.best}일 · 목표 ${String(st.profile.target).toUpperCase()}`)), h('span', '⚙️')));
    const groups = [
      ['학습', [
        ['📝', 'JLPT 모의고사', '실전처럼 시간 제한 시험', 'exam'],
        ['🧘', '집중 모드', '뽀모도로 타이머 + 배경 소리', 'focus'],
        ['🔎', '사전 검색', '단어·한자·문법 통합 검색', 'dict'],
        ['あ', '50음도 표', '히라가나·가타카나 전체', 'kana'],
        ['✍️', '쓰기 연습', '손가락으로 따라 쓰기', 'write/あ'],
      ]],
      ['동기 부여', [
        ['📊', '학습 통계', '학습 시간·XP·잔디 달력', 'stats'],
        ['🏆', '업적', '배지 모으기', 'ach'],
        ['🏅', '주간 리그', '이번 주 순위', 'league'],
        ['🛍️', '상점', '스트릭 프리즈·하트·XP 부스트', 'shop'],
      ]],
      ['앱', [
        ['⚙️', '설정', '목표·소리·후리가나·알림·백업', 'settings'],
        ['ℹ️', '앱 정보·학습 가이드', '이 앱을 200% 활용하는 법', 'about'],
      ]],
    ];
    for (const [g, items] of groups) {
      el.appendChild(h('div.section-title', g));
      const list = h('div.menu-list');
      for (const [i, t, d, r] of items) list.appendChild(h('button.menu-item', { type: 'button', onclick: () => App.go(r) }, h('span.mi-i', { lang: 'ja' }, i), h('div.mi-b', h('div.mi-t', t), h('div.mi-d', d)), h('span.mi-go', '›')));
      el.appendChild(list);
    }
    return { el, title: '더보기', tab: 'more' };
  };

  /* ───────── 사전 ───────── */
  let lastQuery = '';
  App.screens.dict = function () {
    const el = h('div.pad');
    const input = h('input.search', { type: 'search', placeholder: '일본어·한글 뜻·한자·읽기로 검색 (예: 食べる, 먹다, がく)', value: lastQuery, autocomplete: 'off' });
    const filters = h('div.seg');
    let type = 'all';
    const results = h('div.item-list');
    const TYPE = { v: '단어', k: '한자', g: '문법', a: '문자' };
    const run = () => {
      lastQuery = input.value;
      results.innerHTML = '';
      const q = input.value.trim();
      if (!q) {
        results.appendChild(App.ui.empty('🔎', `총 단어 ${App.C.all.v.length} · 한자 ${App.C.all.k.length} · 문법 ${App.C.all.g.length}개를 검색할 수 있어요.`));
        return;
      }
      const list = App.C.search(q).filter((it) => type === 'all' || it.t === type);
      if (!list.length) { results.appendChild(App.ui.empty('🤔', '검색 결과가 없어요.')); return; }
      for (const it of list) {
        const lv = App.C.levelById[it.lv];
        results.appendChild(h('div.irow', { onclick: () => App.views.itemSheet(it) },
          h('span.it-type', TYPE[it.t] || ''), h('span.it-label', { lang: 'ja' }, App.views.itemLabel(it)), h('span.it-lv', { style: { color: lv ? lv.color : '' } }, lv ? lv.name : '')));
      }
    };
    for (const [k, l] of [['all', '전체'], ['v', '단어'], ['k', '한자'], ['g', '문법']]) {
      filters.appendChild(h('button.seg-btn' + (k === 'all' ? '.on' : ''), { type: 'button', onclick: (e) => { type = k; App.$$('.seg-btn', filters).forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); run(); } }, l));
    }
    input.addEventListener('input', util.debounce(run, 150));
    el.append(input, filters, results);
    return { el, title: '사전 검색', back: true, tab: 'more', onMount: () => { run(); input.focus(); } };
  };

  /* ───────── 통계 ───────── */
  App.screens.stats = function () {
    const st = S();
    const el = h('div.pad');
    const days = st.days;
    const keys = [];
    for (let i = 6; i >= 0; i--) keys.push(util.addDays(util.dayKey(), -i));
    const xs = keys.map((k) => (days[k] || {}).xp || 0);
    const mins = keys.map((k) => Math.round(((days[k] || {}).sec || 0) / 60));
    const maxX = Math.max(st.profile.goalXp, ...xs);
    const totalSec = Object.values(days).reduce((a, d) => a + (d.sec || 0), 0);
    const totalN = Object.values(days).reduce((a, d) => a + (d.n || 0), 0);
    const totalOk = Object.values(days).reduce((a, d) => a + (d.ok || 0), 0);
    const sr = App.srs.stats();
    el.appendChild(h('div.stat-grid',
      stat('🔥', `${st.streak.count}일`, '연속 학습'), stat('🏔️', `${st.streak.best}일`, '최고 기록'),
      stat('⚡', st.xp.toLocaleString(), '총 XP'), stat('⏱', util.fmtMin(totalSec), '총 학습 시간'),
      stat('🎯', totalN ? Math.round((totalOk / totalN) * 100) + '%' : '-', '전체 정답률'), stat('📚', String(st.counters.lessons), '완료 레슨'),
      stat('🗂️', String(sr.v), '학습 단어'), stat('漢', String(sr.k), '학습 한자'),
      stat('🧩', String(sr.g), '학습 문법'), stat('🧠', String(sr.mature), '장기 기억 카드'),
      stat('🧊', String(st.streak.freezes), '스트릭 프리즈'), stat('🍅', util.fmtMin(st.counters.focusSec), '집중 모드')));

    el.appendChild(h('div.section-title', '최근 7일 XP'));
    const DAYN = ['일', '월', '화', '수', '목', '금', '토'];
    el.appendChild(h('div.week-chart',
      h('div.wc-area',
        h('div.goal-line', { style: { bottom: Math.round((st.profile.goalXp / maxX) * 100) + '%' } }, h('span', `목표 ${st.profile.goalXp}`)),
        keys.map((k, i) => h('div.wc-col',
          h('div.wc-val', String(xs[i])),
          h('div.wc-bar' + (xs[i] >= st.profile.goalXp ? '.hit' : ''), { style: { height: Math.max(2, Math.round((xs[i] / maxX) * 100)) + '%' } })))),
      h('div.wc-labels', keys.map((k, i) => h('div.wc-lab', h('div.wc-day', DAYN[util.parseDay(k).getDay()]), h('div.wc-min', mins[i] ? `${mins[i]}분` : ''))))));

    el.appendChild(h('div.section-title', '학습 잔디 (최근 16주)'));
    const grid = h('div.heat');
    const startKey = util.addDays(util.weekKey(), -15 * 7);
    for (let w = 0; w < 16; w++) {
      const col = h('div.heat-col');
      for (let d = 0; d < 7; d++) {
        const k = util.addDays(startKey, w * 7 + d);
        const x = (days[k] || {}).xp || 0;
        const lvl = x === 0 ? 0 : x < 10 ? 1 : x < st.profile.goalXp ? 2 : x < st.profile.goalXp * 2 ? 3 : 4;
        col.appendChild(h('i.l' + lvl + (k === util.dayKey() ? '.today' : ''), { title: `${k} · ${x} XP` }));
      }
      grid.appendChild(col);
    }
    el.appendChild(grid);
    el.appendChild(h('div.heat-legend.small.muted', '적음 ', h('i.l0'), h('i.l1'), h('i.l2'), h('i.l3'), h('i.l4'), ' 많음'));

    el.appendChild(h('div.section-title', '레벨별 진도'));
    for (const lv of App.C.levels) {
      const vDone = lv._vocab.filter((v) => App.srs.has(v.id)).length;
      const uDone = lv.units.filter((u) => App.course.unitProgress(u).done).length;
      const nodes = App.path.levelNodes(lv);
      const nDone = nodes.filter((n) => App.path.done(n)).length;
      el.appendChild(h('div.lv-prog', { style: { '--lv': lv.color } },
        h('div.lp-name', lv.name),
        h('div.lp-bars',
          h('div.lp-row', h('span', '코스'), App.ui.bar(uDone / lv.units.length), h('span.small', `${uDone}/${lv.units.length}`)),
          h('div.lp-row', h('span', '챌린지'), App.ui.bar(nodes.length ? nDone / nodes.length : 0), h('span.small', `${nDone}/${nodes.length}`)),
          h('div.lp-row', h('span', '단어'), App.ui.bar(lv._vocab.length ? vDone / lv._vocab.length : 0), h('span.small', `${vDone}/${lv._vocab.length}`)))));
    }
    return { el, title: '학습 통계', back: true, tab: 'more' };
  };
  function stat(icon, val, label) { return h('div.stat', h('div.st-i', { lang: 'ja' }, icon), h('div.st-v', val), h('div.st-l', label)); }

  /* ───────── 업적 ───────── */
  App.screens.ach = function () {
    const st = S();
    App.game.checkAch();
    const el = h('div.pad');
    const got = App.game.ACH.filter((a) => st.ach[a[0]]).length;
    el.appendChild(h('p.center', `획득한 배지 ${got} / ${App.game.ACH.length}`));
    el.appendChild(App.ui.bar(got / App.game.ACH.length));
    const grid = h('div.ach-grid');
    for (const [id, icon, title, desc, , gems] of App.game.ACH) {
      const on = !!st.ach[id];
      grid.appendChild(h('div.ach' + (on ? '.on' : ''), h('div.ach-i', { lang: 'ja' }, icon), h('div.ach-t', title), h('div.ach-d', desc), h('div.ach-g', on ? `✅ ${new Date(st.ach[id]).toLocaleDateString('ko-KR')}` : `💎 ${gems}`)));
    }
    el.appendChild(grid);
    return { el, title: '업적', back: true, tab: 'more' };
  };

  /* ───────── 리그 ───────── */
  App.screens.league = function () {
    const L = App.game.league();
    const el = h('div.pad');
    const [tname, tcolor, ticon] = L.tierInfo;
    const daysLeft = Math.max(0, Math.ceil(L.msLeft / 86400000));
    el.appendChild(h('div.league-hero', { style: { '--tier': tcolor } },
      h('div.lh-icon', ticon), h('div.lh-tier', `${tname} 리그`),
      h('p.small', `상위 3명은 다음 주에 승급해요! 종료까지 ${daysLeft}일`),
      L.last ? h('p.small.muted', `지난주: ${L.last.rank}위 (${L.last.xp} XP) ${L.last.change > 0 ? '⬆️ 승급' : L.last.change < 0 ? '⬇️ 강등' : ''}`) : null));
    const tiers = h('div.tier-row');
    App.game.TIERS.forEach(([n, c, i], k) => tiers.appendChild(h('span.tier' + (k === L.tier ? '.on' : '') + (k > L.tier ? '.lock' : ''), { title: n, style: { '--tier': c } }, i)));
    el.appendChild(tiers);
    const list = h('div.league-list');
    L.table.forEach((m, i) => {
      const zone = i < 3 ? 'up' : i >= L.table.length - 3 && L.tier > 0 ? 'down' : '';
      list.appendChild(h('div.lrow' + (m.me ? '.me' : '') + (zone ? '.' + zone : ''),
        h('span.lr-rank', i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1)), h('span.lr-av', m.avatar), h('span.lr-name', { lang: 'ja' }, m.name + (m.me ? ' (나)' : '')), h('span.lr-xp', `${m.xp} XP`)));
      if (i === 2) list.appendChild(h('div.zone-line.up', '⬆️ 승급 구역'));
      if (i === L.table.length - 4 && L.tier > 0) list.appendChild(h('div.zone-line.down', '⬇️ 강등 구역'));
    });
    el.appendChild(list);
    el.appendChild(h('p.small.muted.center', '리그 참가자는 학습 동기 부여를 위한 가상의 학습 친구들이에요.'));
    return { el, title: '주간 리그', back: true, tab: 'more' };
  };

  /* ───────── 상점 ───────── */
  App.screens.shop = function () {
    const st = S();
    const el = h('div.pad');
    el.appendChild(h('div.gem-hero', h('div', '💎'), h('b', `${st.gems}`), h('p.small.muted', '레슨 완료·일일 목표·업적·리그 순위로 젬을 모을 수 있어요.')));
    const items = [
      ['🧊', '스트릭 프리즈', '하루를 쉬어도 연속 기록을 지켜 줘요 (최대 3개 보유)', 200, () => st.streak.freezes < 3, () => { st.streak.freezes++; }],
      ['❤️', '하트 모두 회복', '챌린지 하트를 5개로 채워요', 350, () => st.hearts < App.game.HEART_MAX && st.settings.hearts, () => App.game.gainHeart(5)],
      ['⚡', 'XP 2배 부스트 (15분)', '15분 동안 모든 XP가 2배!', 100, () => !App.game.boostActive(), () => { st.boostUntil = Date.now() + 15 * 60000; }],
      ['🦊', '프로필 아바타 변경', '마음에 드는 아바타로 바꿔요', 50, () => true, () => pickAvatar()],
    ];
    const list = h('div.shop-list');
    for (const [i, t, d, cost, can, buy] of items) {
      const ok = can();
      list.appendChild(h('div.shop-item', h('div.si-i', i), h('div.si-b', h('div.si-t', t), h('div.si-d', d)),
        h('button.btn.small' + (ok && st.gems >= cost ? '.primary' : '.ghost'), { type: 'button', disabled: !ok || st.gems < cost, onclick: () => {
          if (!App.game.spendGems(cost)) return App.ui.toast('젬이 부족해요');
          buy(); App.store.save(); App.sfx.done(); App.ui.toast(`${t} 구매 완료!`); App.rerender();
        } }, `💎 ${cost}`)));
    }
    el.appendChild(list);
    if (App.game.boostActive()) el.appendChild(h('p.center', `⚡ XP 부스트 사용 중 (${Math.ceil((st.boostUntil - Date.now()) / 60000)}분 남음)`));
    el.appendChild(h('p.small.muted.center', `보유 스트릭 프리즈: ${st.streak.freezes}개`));
    return { el, title: '상점', back: true, tab: 'more' };
  };

  function pickAvatar() {
    const av = ['🦊', '🐱', '🐶', '🐼', '🐸', '🐯', '🦉', '🐙', '🦄', '🐧', '🌸', '🍙', '🍣', '🗻', '⛩️', '🎋', '🐉', '🍵'];
    App.ui.sheet((body, close) => {
      const g = h('div.avatar-grid');
      av.forEach((a) => g.appendChild(h('button.av', { type: 'button', onclick: () => { S().profile.avatar = a; App.store.save(); close(); App.rerender(); } }, a)));
      body.appendChild(g);
    }, { title: '아바타 선택' });
  }
  App.pickAvatar = pickAvatar;
})();
