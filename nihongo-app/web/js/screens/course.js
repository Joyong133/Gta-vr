/* 체계 코스: 레벨 목록 → 단원 목록 → 단원 학습(강의·단어·한자·회화·독해·테스트) */
'use strict';

(function () {
  const { h, util, jp } = App;
  const S = () => App.store.state;

  function unitProgress(u) {
    const c = S().course[u.id] || {};
    const tabs = unitTabs(u).filter((t) => t[0] !== 'test');
    const seen = tabs.filter((t) => c.seen && c.seen[t[0]]).length;
    return { seen, total: tabs.length, test: c.test || 0, done: !!c.done || App.game.unitDone(u) };
  }

  function unitTabs(u) {
    const t = [];
    if ((u.lessons || []).length || u._grammar.length) t.push(['learn', '📖', u._grammar.length ? '문법' : '강의']);
    if (u._kana.length) t.push(['kana', 'あ', '문자']);
    if (u._vocab.length) t.push(['vocab', '🗂️', '단어']);
    if (u._kanji.length) t.push(['kanji', '漢', '한자']);
    if ((u.talk || []).length) t.push(['talk', '💬', '회화']);
    if ((u.reading || []).length) t.push(['read', '📰', '독해']);
    if (u._vocab.length || u._kana.length || u._grammar.length) t.push(['test', '✅', '테스트']);
    return t;
  }
  App.course = { unitProgress, unitTabs };

  /* ───────── 레벨 목록 ───────── */
  App.screens.course = function () {
    const el = h('div.pad');
    const last = App.C.unitById[S().lastUnit];
    if (last) {
      el.appendChild(h('button.continue-card', { type: 'button', onclick: () => App.go('unit/' + last.id) },
        h('div.cc-icon', last.icon || '📘'),
        h('div.cc-body', h('div.cc-label', '이어서 학습'), h('div.cc-title', `${last.level.name} · ${last.title}`)),
        h('div.cc-go', '›')));
    }
    el.appendChild(h('div.section-title', '레벨 선택'));
    el.appendChild(h('p.small.muted', '체계 코스는 강의 → 예문 → 확인 문제 → 단원 테스트 순으로 깊이 있게 학습해요. 단원 테스트 80% 이상이면 통과!'));
    for (const lv of App.C.levels) {
      const done = lv.units.filter((u) => unitProgress(u).done).length;
      el.appendChild(h('button.level-card', { type: 'button', style: { '--lv': lv.color }, onclick: () => App.go('level/' + lv.id) },
        h('div.lc-badge', lv.name),
        h('div.lc-body',
          h('div.lc-title', lv.title),
          h('div.lc-desc', lv.desc),
          h('div.lc-stats', `단원 ${lv.units.length} · 단어 ${lv._vocab.length} · 한자 ${lv._kanji.length} · 문법 ${lv._grammar.length}`),
          App.ui.bar(done / lv.units.length)),
        h('div.lc-pct', `${Math.round((done / lv.units.length) * 100)}%`)));
    }
    return { el, title: '체계 코스', tab: 'course' };
  };

  /* ───────── 단원 목록 ───────── */
  App.screens.level = function ([id]) {
    const lv = App.C.levelById[id];
    if (!lv) return App.screens.course();
    const el = h('div.pad');
    el.appendChild(h('div.level-hero', { style: { '--lv': lv.color } },
      h('div.lh-name', lv.name), h('div.lh-title', lv.title), h('p.lh-desc', lv.desc)));
    if (lv.id !== 'kana') {
      el.appendChild(h('div.row.gap',
        h('button.btn.ghost.grow', { type: 'button', onclick: () => App.go('exam/' + lv.id) }, '📝 모의고사'),
        h('button.btn.ghost.grow', { type: 'button', onclick: () => App.go('cards/level/' + lv.id) }, '🃏 레벨 단어 카드')));
    }
    lv.units.forEach((u, i) => {
      const p = unitProgress(u);
      const counts = [
        u._kana.length ? `문자 ${u._kana.length}` : '',
        u._grammar.length ? `문법 ${u._grammar.length}` : '',
        u._vocab.length ? `단어 ${u._vocab.length}` : '',
        u._kanji.length ? `한자 ${u._kanji.length}` : '',
      ].filter(Boolean).join(' · ');
      el.appendChild(h('button.unit-card' + (p.done ? '.done' : ''), { type: 'button', style: { '--lv': lv.color }, onclick: () => App.go('unit/' + u.id) },
        h('div.uc-icon', { lang: 'ja' }, u.icon || String(i + 1)),
        h('div.uc-body',
          h('div.uc-num', `UNIT ${i + 1}`),
          h('div.uc-title', u.title),
          h('div.uc-goal', u.goal),
          h('div.uc-meta', counts),
          App.ui.bar(p.total ? p.seen / p.total : 0)),
        h('div.uc-status', p.done ? '✅' : p.test ? `${p.test}%` : '›')));
    });
    return { el, title: `${lv.name} ${lv.title}`, back: true, tab: 'course' };
  };

  /* ───────── 단원 학습 ───────── */
  let lastTab = {};
  App.screens.unit = function ([id], query) {
    const u = App.C.unitById[id];
    if (!u) return App.screens.course();
    S().lastUnit = u.id;
    const c = (S().course[u.id] = S().course[u.id] || { seen: {} });
    c.seen = c.seen || {};
    App.store.save();
    const tabs = unitTabs(u);
    let tab = query.tab || lastTab[u.id] || tabs[0][0];
    if (!tabs.some((t) => t[0] === tab)) tab = tabs[0][0];

    const el = h('div.unit-page');
    const hero = h('div.unit-hero', { style: { '--lv': u.level.color } },
      h('div.uh-top', h('span.uh-lv', u.level.name), h('span.uh-num', `UNIT ${u.index + 1}`)),
      h('div.uh-title', u.title),
      h('div.uh-goal', '🎯 ' + u.goal));
    const tabBar = h('div.tabbar');
    const body = h('div.tab-body.pad');
    el.append(hero, tabBar, body);

    const show = (t) => {
      tab = t;
      lastTab[u.id] = t;
      if (t !== 'test') {
        c.seen[t] = true;
        const td = App.game.today();
        td.cu = td.cu || {};
        td.cu[u.id + ':' + t] = 1;
        App.store.save();
      }
      App.$$('.tb', tabBar).forEach((b) => b.classList.toggle('on', b.dataset.t === t));
      body.innerHTML = '';
      const fn = TABS[t];
      if (fn) fn(u, body);
      body.appendChild(nextNav(u, t, tabs, show));
    };
    for (const [tid, icon, label] of tabs) {
      tabBar.appendChild(h('button.tb', { type: 'button', data: { t: tid }, onclick: () => { show(tid); tabBar.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }, h('span', icon), h('span', label)));
    }
    return { el, title: `${u.level.name} · ${u.title}`, back: true, tab: 'course', study: true, onMount: () => show(tab) };
  };

  function nextNav(u, t, tabs, show) {
    const i = tabs.findIndex((x) => x[0] === t);
    const nxt = tabs[i + 1];
    const row = h('div.next-nav');
    if (nxt) row.appendChild(h('button.btn.primary.block', { type: 'button', onclick: () => { show(nxt[0]); window.scrollTo(0, 0); App.$('#view').scrollTop = 0; } }, `다음: ${nxt[1]} ${nxt[2]} →`));
    else {
      const nu = App.C.nextUnit(u);
      if (nu) row.appendChild(h('button.btn.ghost.block', { type: 'button', onclick: () => App.go('unit/' + nu.id, true) }, `다음 단원: ${nu.title} →`));
    }
    return row;
  }

  const TABS = {
    learn(u, body) {
      for (const l of u.lessons || []) {
        const card = h('div.lesson-card', h('div.lc-head', '📌 ' + l.t), h('div.lc-html', { html: l.h }));
        App.$$('.jp', card).forEach((x) => { x.setAttribute('lang', 'ja'); x.classList.add('tappable'); x.addEventListener('click', () => App.tts.speak(x.textContent)); });
        body.appendChild(card);
      }
      if (u._grammar.length) {
        body.appendChild(h('div.section-title', `문법 포인트 ${u._grammar.length}개`));
        body.appendChild(h('p.small.muted', '카드를 눌러 펼치세요. 예문을 누르면 발음을 들을 수 있어요.'));
        u._grammar.forEach((g, i) => body.appendChild(App.views.grammarCard(g, { open: i === 0 })));
      }
    },
    kana(u, body) {
      body.appendChild(h('p.small.muted', '글자를 누르면 발음을 듣고 기억 팁을 볼 수 있어요. 길게 보고, 소리 내어 따라 읽으세요.'));
      const specs = [u.kana, u.extraKana].filter(Boolean);
      for (const [group, rows] of specs) for (const r of rows) {
        const row = App.C.kanaGroups[group][r];
        body.appendChild(h('div.section-title', row.row));
        const grid = h('div.kana-grid');
        for (const a of row.chars) {
          grid.appendChild(h('button.kana-cell', { type: 'button', onclick: () => { App.tts.speak(a.c); kanaTip(a); } },
            h('span.kc', { lang: 'ja' }, a.c), h('span.kr', `${a.ko} · ${a.ro}`)));
        }
        body.appendChild(grid);
      }
      body.appendChild(h('div.row.gap',
        h('button.btn.ghost.grow', { type: 'button', onclick: () => App.go('kana') }, '📋 전체 50음도'),
        h('button.btn.primary.grow', { type: 'button', onclick: () => App.go('lesson/practice/' + u.id) }, '✍️ 연습 문제')));
      if (u._vocab.length) {
        body.appendChild(h('div.section-title', '이 글자로 읽어 보는 낱말'));
        u._vocab.forEach((v) => body.appendChild(App.views.vocabRow(v)));
      }
    },
    vocab(u, body) {
      body.appendChild(h('div.row.gap.wrap',
        h('button.btn.primary.grow', { type: 'button', onclick: () => App.go('cards/unit/' + u.id) }, '🃏 카드 학습'),
        h('button.btn.ghost.grow', { type: 'button', onclick: () => autoPlay(u._vocab) }, '🎧 듣기'),
        h('button.btn.ghost.grow', { type: 'button', onclick: () => App.go('lesson/practice/' + u.id) }, '✍️ 연습')));
      const hide = h('div.row.gap.toggles',
        h('label.toggle', h('input', { type: 'checkbox', onchange: (e) => body.classList.toggle('hide-mean', e.target.checked) }), '뜻 가리기'),
        h('label.toggle', h('input', { type: 'checkbox', onchange: (e) => body.classList.toggle('hide-read', e.target.checked) }), '읽기 가리기'));
      body.appendChild(hide);
      body.appendChild(h('p.small.muted', `단어 ${u._vocab.length}개 · 예문이 있는 단어는 눌러서 펼쳐 보세요. ☆로 즐겨찾기`));
      u._vocab.forEach((v) => body.appendChild(App.views.vocabRow(v)));
      App.srs.addMany(u._vocab.map((v) => v.id), 24 * 3600000);
    },
    kanji(u, body) {
      body.appendChild(h('p.small.muted', '한자를 누르면 음독·훈독과 대표 단어, 쓰기 연습을 볼 수 있어요. 한국 한자음(훈음)과 연결해 외우면 훨씬 쉬워요!'));
      const grid = h('div.kanji-grid');
      u._kanji.forEach((k) => grid.appendChild(App.views.kanjiTile(k)));
      body.appendChild(grid);
      body.appendChild(h('div.section-title', '한눈에 보기'));
      for (const k of u._kanji) {
        body.appendChild(h('div.krow', h('span.krow-c', { lang: 'ja' }, k.c), h('div.krow-b',
          h('div', h('b', k.ko), h('span.muted', ` · 음 ${k.on} · 훈 ${k.kun}`)),
          h('div.small', { lang: 'ja', html: k.words.map((w) => `${jp.ruby(w.w)} <span class="muted">${util.esc(w.m || '')}</span>`).join(' · ') }))));
      }
    },
    talk(u, body) {
      const lines = u.talk;
      const box = h('div.talk');
      const people = util.uniq(lines.map((l) => l[0]));
      lines.forEach((l, i) => {
        const right = people.indexOf(l[0]) % 2 === 1;
        const ko = h('div.b-ko.hidden', l[2]);
        box.appendChild(h('div.bubble-row' + (right ? '.right' : ''),
          h('div.who', l[0]),
          h('div.bubble', { data: { i } , onclick: () => App.tts.speak(l[1]) }, h('div.b-jp', { lang: 'ja', html: jp.ruby(l[1]) }), ko)));
      });
      body.append(
        h('div.row.gap.wrap',
          h('button.btn.primary.grow', { type: 'button', onclick: () => playTalk(lines, box) }, '▶ 전체 재생'),
          h('button.btn.ghost.grow', { type: 'button', onclick: () => App.$$('.b-ko', box).forEach((x) => x.classList.toggle('hidden')) }, '🇰🇷 번역')),
        h('p.small.muted', '말풍선을 누르면 한 문장씩 들을 수 있어요. 소리 내어 따라 하며 섀도잉 해 보세요!'),
        box);
    },
    read(u, body) {
      for (const r of u.reading) body.appendChild(readingBlock(r));
    },
    test(u, body) {
      const p = unitProgress(u);
      body.append(
        h('div.test-card',
          h('div.tc-icon', p.done ? '🏅' : '📝'),
          h('div.tc-title', '단원 테스트'),
          h('p', `이 단원의 문자·단어·한자·문법을 섞어 20문항 내외로 출제해요. 80% 이상이면 통과! 통과하면 학습 항목이 복습 카드에 등록돼요.`),
          h('div.tc-best', p.test ? `최고 점수 ${p.test}% ${p.done ? '· 통과 ✅' : ''}` : '아직 응시 기록이 없어요'),
          h('button.btn.primary.block', { type: 'button', onclick: () => App.go('lesson/test/' + u.id) }, p.test ? '다시 도전' : '테스트 시작')),
        h('button.btn.ghost.block', { type: 'button', onclick: () => App.go('lesson/practice/' + u.id) }, '✍️ 가볍게 연습 문제 먼저 풀기'),
      );
    },
  };

  function kanaTip(a) {
    App.ui.toast(`${a.c} = ${a.ko} (${a.ro})${a.origin ? ' · 유래: ' + a.origin : ''}${a.tip ? ' · ' + a.tip : ''}`, 3500);
  }

  function readingBlock(r) {
    const card = h('div.reading');
    const paras = r.jp.split('\n'), kos = r.ko.split('\n');
    const text = h('div.passage');
    paras.forEach((p, i) => {
      text.appendChild(h('p.jp-para', { lang: 'ja', html: jp.ruby(p), onclick: () => App.tts.speak(p) }));
      text.appendChild(h('p.ko-para.hidden', kos[i] || ''));
    });
    card.append(
      h('div.rd-title', '📰 ' + r.t),
      h('div.row.gap.wrap',
        h('button.btn.small.ghost', { type: 'button', onclick: () => App.tts.speak(r.jp.replace(/\n/g, '')) }, '🔊 전체 듣기'),
        h('button.btn.small.ghost', { type: 'button', onclick: () => App.$$('.ko-para', text).forEach((x) => x.classList.toggle('hidden')) }, '🇰🇷 번역')),
      text);
    (r.q || []).forEach(([q, opts, ans], qi) => {
      const box = h('div.mq', h('div.mq-stem', `Q${qi + 1}. ${q}`));
      const row = h('div.mq-opts.col');
      let done = false;
      opts.forEach((o, i) => {
        const b = h('button.mq-opt', { type: 'button' }, o);
        b.addEventListener('click', () => {
          if (done) return;
          done = true;
          const ok = i === ans;
          b.classList.add(ok ? 'good' : 'bad');
          if (!ok) row.children[ans].classList.add('good');
          ok ? App.sfx.good() : App.sfx.bad();
          App.game.recordAnswer(ok);
          if (ok) App.game.addXp(2);
        });
        row.appendChild(b);
      });
      box.appendChild(row);
      card.appendChild(box);
    });
    return card;
  }
  App.views.readingBlock = readingBlock;

  // 순차 재생 (TTS 완료 콜백 없이 글자 수 기반으로 간격 추정)
  let playToken = 0;
  async function autoPlay(vocab) {
    const token = ++playToken;
    App.ui.toast('연속 듣기를 시작해요 (화면을 벗어나면 멈춰요)');
    const route = location.hash;
    for (const v of vocab) {
      if (token !== playToken || location.hash !== route) return;
      App.tts.speak(v.r);
      await util.sleep(700 + [...v.r].length * 230);
      if (token !== playToken || location.hash !== route) return;
      App.tts.speak(v.m.split(/[;,]/)[0], { lang: 'ko-KR', rate: 1.0 });
      await util.sleep(900 + v.m.length * 120);
    }
  }
  async function playTalk(lines, box) {
    const token = ++playToken;
    const route = location.hash;
    const bubbles = App.$$('.bubble', box);
    for (let i = 0; i < lines.length; i++) {
      if (token !== playToken || location.hash !== route) break;
      bubbles.forEach((b) => b.classList.remove('playing'));
      bubbles[i].classList.add('playing');
      bubbles[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
      App.tts.speak(lines[i][1]);
      await util.sleep(900 + jp.plain(lines[i][1]).length * 210);
    }
    bubbles.forEach((b) => b.classList.remove('playing'));
  }
  App.course.stopPlay = () => { playToken++; };
})();
