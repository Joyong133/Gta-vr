/* 챌린지 로드 화면: 레벨별 지그재그 경로 */
'use strict';

(function () {
  const { h, util } = App;
  const S = () => App.store.state;
  let selLevel = null;

  App.screens.path = function ([lvId]) {
    const cur = App.path.current();
    const levelId = lvId || selLevel || (cur ? cur.unit.lv : 'kana');
    selLevel = levelId;
    const lv = App.C.levelById[levelId] || App.C.levels[0];
    const el = h('div.path-page');

    const chips = h('div.level-chips');
    for (const l of App.C.levels) {
      const open = App.path.levelOpen(l);
      chips.appendChild(h('button.lchip' + (l === lv ? '.on' : '') + (open ? '' : '.locked'), { type: 'button', style: { '--lv': l.color }, onclick: () => { selLevel = l.id; App.go('path/' + l.id, true); } },
        (open ? '' : '🔒 ') + l.name));
    }
    el.appendChild(chips);

    const nodes = App.path.levelNodes(lv);
    const doneN = nodes.filter((n) => App.path.done(n)).length;
    const lvOpen = App.path.levelOpen(lv);
    el.appendChild(h('div.path-hero', { style: { '--lv': lv.color } },
      h('div.ph-row', h('div', h('div.ph-name', `${lv.name} · ${lv.title}`), h('div.ph-sub', `${doneN} / ${nodes.length} 레슨 완료`)), App.ui.ring(doneN / nodes.length, 54, 6, `${Math.round((doneN / nodes.length) * 100)}%`)),
      !lvOpen ? h('p.small', '이전 레벨을 마치거나 건너뛰기 테스트에 합격하면 열려요.') : null,
      lv.id !== 'kana' && !S().skipped[lv.id] && doneN < nodes.length ? h('button.btn.small.ghost.on-color', { type: 'button', onclick: () => skipInfo(lv) }, '🚀 건너뛰기 테스트') : null));

    const road = h('div.road');
    let k = 0;
    for (const u of lv.units) {
      const ns = App.path.nodesOf(u);
      if (!ns.length) continue;
      road.appendChild(h('div.unit-banner', { style: { '--lv': lv.color } },
        h('div.ub-text', h('div.ub-num', `유닛 ${u.index + 1}`), h('div.ub-title', u.title)),
        h('button.ub-btn', { type: 'button', onclick: () => App.go('unit/' + u.id) }, '📘 강의')));
      for (const n of ns) {
        const st = App.path.status(n);
        const p = S().path[n.id] || {};
        const x = Math.sin(k * 0.9) * 32;
        k++;
        const crowns = Math.min(5, p.n || 0);
        const btn = h('button.node.' + st + '.t-' + n.type, {
          type: 'button', style: { transform: `translateX(${x}%)`, '--lv': lv.color },
          'aria-label': n.label, onclick: () => nodeSheet(n, st),
        },
          h('span.n-ic', { lang: 'ja' }, st === 'locked' ? '🔒' : n.icon),
          crowns ? h('span.n-crown', '👑' + (crowns > 1 ? crowns : '')) : null);
        const wrap = h('div.node-wrap', btn, h('div.n-label', { style: { transform: `translateX(${x}%)` } }, n.label));
        if (cur && cur.id === n.id) {
          wrap.classList.add('current');
          wrap.insertBefore(h('div.start-bubble', { style: { transform: `translateX(${x}%)` } }, '시작!'), btn);
        }
        road.appendChild(wrap);
      }
    }
    el.appendChild(road);
    el.appendChild(h('div.road-end', '🏯', h('p.small.muted', `${lv.name} 완주를 향해! がんばって!`)));

    return {
      el, title: '챌린지 로드', tab: 'path',
      onMount: () => {
        const c = App.$('.node-wrap.current', el);
        if (c) c.scrollIntoView({ block: 'center' });
      },
    };
  };

  function nodeSheet(n, st) {
    if (st === 'locked') {
      App.ui.toast('🔒 앞의 레슨을 먼저 완료하세요');
      return;
    }
    const p = S().path[n.id] || {};
    const desc = {
      kana: () => `글자 ${n.data.length}개: ${n.data.map((a) => a.c).join(' ')}`,
      words: () => `낱말 ${n.data.length}개 읽기 연습`,
      vocab: () => `새 단어 ${n.data.length}개: ${n.data.slice(0, 4).map((v) => v.w).join(', ')}…`,
      kanji: () => `한자 ${n.data.length}자: ${n.data.map((k) => k.c).join(' ')}`,
      grammar: () => n.data.map((g) => App.jp.plain(g.p)).join(' / '),
      talk: () => '듣기·문장 조립·말하기 중심 연습',
      read: () => `짧은 이야기: ${n.data.t}`,
      review: () => '유닛 전체를 섞은 보스 스테이지! 실수 없이 도전해 보세요.',
      guide: () => '문자와 발음의 기본 원리를 읽어요',
    }[n.type];
    App.ui.sheet((body, close) => {
      body.append(
        h('div.node-sheet',
          h('div.ns-icon', { lang: 'ja' }, n.icon),
          h('div.ns-unit', `${n.unit.level.name} · 유닛 ${n.unit.index + 1} · ${n.unit.title}`),
          h('div.ns-title', n.label),
          h('p.ns-desc', { lang: 'ja' }, desc ? desc() : ''),
          p.n ? h('p.small.muted', `완료 ${p.n}회 · 최고 정확도 ${p.best || 0}%`) : null,
          h('button.btn.primary.block.big', { type: 'button', onclick: () => {
            if (S().settings.hearts && App.game.hearts() <= 0 && !['guide', 'read'].includes(n.type)) { close(); App.ui.heartsSheet(); return; }
            close(); App.go('lesson/node/' + encodeURIComponent(n.id));
          } }, p.n ? `다시 연습 +${n.xp} XP` : `시작하기 +${n.xp} XP`),
          n.type === 'grammar' ? h('button.btn.ghost.block', { type: 'button', onclick: () => { close(); App.go('unit/' + n.unit.id + '?tab=learn'); } }, '📘 먼저 문법 강의 보기') : null),
      );
    });
  }

  function skipInfo(lv) {
    App.ui.confirm(`<b>${lv.name} 건너뛰기 테스트</b><br><br>이미 ${lv.name} 수준을 알고 있다면 24문항 테스트에서 80% 이상을 맞혀 레벨 전체를 열 수 있어요. 하트는 소모되지 않아요.`, { ok: '도전하기', cancel: '나중에' })
      .then((ok) => { if (ok) App.go('lesson/skip/' + lv.id); });
  }
})();
