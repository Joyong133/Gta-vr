/* 복습 허브 + 플래시카드 (SRS / 학습 모드) */
'use strict';

(function () {
  const { h, util, jp } = App;
  const S = () => App.store.state;
  const TYPE_NAME = { v: '단어', k: '한자', g: '문법', a: '문자', s: '문장' };

  App.screens.review = function () {
    const el = h('div.pad');
    const st = App.srs.stats();
    const fc = App.srs.forecast(7);
    const maxF = Math.max(1, ...fc);
    el.appendChild(h('div.review-hero',
      h('div.rh-due', h('div.rh-num', String(st.due)), h('div.rh-label', '오늘 복습할 카드')),
      h('div.rh-stats',
        h('div', `전체 카드 ${st.total}`), h('div', `학습 완료 ${st.learned}`), h('div', `장기 기억 ${st.mature}`)),
      h('div.forecast', fc.map((n, i) => h('div.fc-col', h('div.fc-bar', { style: { height: Math.round((n / maxF) * 100) + '%' } }), h('div.fc-n', String(n)), h('div.fc-d', i === 0 ? '오늘' : `+${i}`))))));
    el.appendChild(h('button.btn.primary.block.big', { type: 'button', disabled: !st.due, onclick: () => App.go('cards/srs/all') }, st.due ? `🃏 플래시카드 복습 시작 (${Math.min(st.due, S().settings.reviewBatch)}장)` : '🎉 오늘 복습 완료!'));
    el.appendChild(h('div.row.gap.wrap',
      ['v', 'k', 'g', 'a'].map((t) => {
        const n = App.srs.dueIds(9999, (it) => it.t === t).length;
        return h('button.btn.ghost.grow.small', { type: 'button', disabled: !n, onclick: () => App.go('cards/srs/' + t) }, `${TYPE_NAME[t]} ${n}`);
      })));
    el.appendChild(h('button.btn.ghost.block', { type: 'button', onclick: () => App.go('lesson/quiz/x') }, '🧠 퀴즈 형식으로 복습하기'));
    el.appendChild(h('p.small.muted', '💡 간격 반복(SRS): 기억이 희미해질 즈음에 다시 보여 줘서 장기 기억으로 옮겨요. "좋음"을 누를수록 간격이 1일 → 3일 → 1주 → 한 달로 늘어나요.'));

    // 새 단어 학습
    el.appendChild(h('div.section-title', '새 카드 학습'));
    const grid = h('div.new-grid');
    for (const lv of App.C.levels) {
      const newN = lv._vocab.concat(lv._kanji).filter((x) => !App.srs.has(x.id)).length;
      grid.appendChild(h('button.new-card', { type: 'button', style: { '--lv': lv.color }, disabled: !newN, onclick: () => App.go('cards/level/' + lv.id) },
        h('b', lv.name), h('span.small', `새 카드 ${newN}`)));
    }
    el.appendChild(grid);

    // 오답 노트
    const wrong = Object.entries(S().wrong).sort((a, b) => b[1].ts - a[1].ts);
    el.appendChild(h('div.section-title', `❌ 오답 노트 (${wrong.length})`));
    if (wrong.length) {
      el.appendChild(h('div.row.gap',
        h('button.btn.primary.grow', { type: 'button', onclick: () => App.go('lesson/wrong/x') }, '오답 퀴즈'),
        h('button.btn.ghost.grow', { type: 'button', onclick: () => App.ui.confirm('오답 노트를 모두 비울까요?', { danger: true, ok: '비우기' }).then((ok) => { if (ok) { S().wrong = {}; App.store.save(); App.rerender(); } }) }, '비우기')));
      const list = h('div.item-list');
      for (const [id, w] of wrong.slice(0, 60)) {
        const it = App.C.items[id];
        if (!it) continue;
        list.appendChild(h('div.irow', { onclick: () => App.views.itemSheet(it) },
          h('span.it-type', TYPE_NAME[it.t]), h('span.it-label', { lang: 'ja' }, App.views.itemLabel(it)), h('span.it-n', `×${w.n}`),
          h('button.icon-btn', { type: 'button', 'aria-label': '삭제', onclick: (e) => { e.stopPropagation(); App.srs.clearWrong(id); e.target.closest('.irow').remove(); } }, '✕')));
      }
      el.appendChild(list);
    } else el.appendChild(App.ui.empty('✨', '틀린 문제가 여기에 자동으로 모여요.'));

    // 즐겨찾기
    const marks = Object.keys(S().marks);
    el.appendChild(h('div.section-title', `⭐ 즐겨찾기 (${marks.length})`));
    if (marks.length) {
      el.appendChild(h('div.row.gap',
        h('button.btn.primary.grow', { type: 'button', onclick: () => App.go('cards/marks/x') }, '카드로 보기'),
        h('button.btn.ghost.grow', { type: 'button', onclick: () => App.go('lesson/mark/x') }, '퀴즈')));
      const list = h('div.item-list');
      for (const id of marks.slice(0, 80)) {
        const it = App.C.items[id];
        if (!it) continue;
        list.appendChild(h('div.irow', { onclick: () => App.views.itemSheet(it) }, h('span.it-type', TYPE_NAME[it.t]), h('span.it-label', { lang: 'ja' }, App.views.itemLabel(it))));
      }
      el.appendChild(list);
    } else el.appendChild(App.ui.empty('☆', '단어·문법의 ☆을 눌러 나만의 단어장을 만드세요.'));
    return { el, title: '복습', tab: 'review' };
  };

  /* ───────── 플래시카드 ───────── */
  function cardFaces(it, reverse) {
    const front = h('div.face.front');
    const back = h('div.face.back');
    const typeTag = h('span.cf-type', TYPE_NAME[it.t]);
    if (it.t === 'v') {
      if (reverse) front.append(typeTag, h('div.cf-ko', it.m), h('div.cf-hint', '일본어로 떠올려 보세요'));
      else front.append(typeTag, h('div.cf-big', { lang: 'ja' }, it.w));
      back.append(h('div.cf-big.sm', { lang: 'ja' }, it.w), it.r !== it.w ? h('div.cf-read', { lang: 'ja' }, it.r) : null, h('div.cf-mean', it.m),
        it.ex ? h('div.cf-ex', { lang: 'ja', html: jp.ruby(it.ex) + `<div class="small muted">${util.esc(it.exKo)}</div>` }) : null);
    } else if (it.t === 'k') {
      front.append(typeTag, h('div.cf-big.kanji', { lang: 'ja' }, it.c));
      back.append(h('div.cf-big.sm', { lang: 'ja' }, it.c), h('div.cf-mean', it.ko), h('div.cf-read', { lang: 'ja' }, `음 ${it.on} · 훈 ${it.kun}`),
        h('div.cf-ex', { lang: 'ja', html: it.words.map((w) => `${jp.ruby(w.w)} <small class="muted">${util.esc(w.m || '')}</small>`).join('<br>') }));
    } else if (it.t === 'g') {
      front.append(typeTag, h('div.cf-pat', { lang: 'ja', html: jp.ruby(it.p) }), h('div.cf-hint', '뜻과 접속을 떠올려 보세요'));
      back.append(h('div.cf-pat.sm', { lang: 'ja', html: jp.ruby(it.p) }), h('div.cf-mean', it.m), h('div.cf-read', { lang: 'ja', html: jp.ruby(it.f) }),
        it.ex && it.ex[0] ? h('div.cf-ex', { lang: 'ja', html: jp.ruby(it.ex[0][0]) + `<div class="small muted">${util.esc(it.ex[0][1])}</div>` }) : null);
    } else if (it.t === 'a') {
      front.append(typeTag, h('div.cf-big.kana', { lang: 'ja' }, it.c));
      back.append(h('div.cf-big.sm', { lang: 'ja' }, it.c), h('div.cf-mean', `${it.ko} · ${it.ro}`), it.tip ? h('div.cf-ex', '💡 ' + it.tip) : null);
    } else if (it.t === 's') {
      front.append(typeTag, h('div.cf-sent', { lang: 'ja', html: jp.ruby(it.jp) }));
      back.append(h('div.cf-sent.sm', { lang: 'ja', html: jp.ruby(it.jp) }), h('div.cf-mean', it.ko));
    }
    return [front, back];
  }

  function ttsOf(it) {
    return it.t === 'v' ? it.r : it.t === 'k' ? jp.kana(it.words[0].w) : it.t === 'g' ? (it.ex[0] || [it.p])[0] : it.t === 'a' ? it.c : it.jp;
  }

  App.screens.cards = function ([mode, id]) {
    const st = S();
    let ids = [];
    let learn = false;
    let title = '플래시카드';
    if (mode === 'srs') {
      ids = App.srs.dueIds(st.settings.reviewBatch, id && id !== 'all' ? (it) => it.t === id : null);
      title = 'SRS 복습';
    } else if (mode === 'unit') {
      const u = App.C.unitById[id];
      if (u) { ids = [].concat(u._vocab, u._kanji, u._kana).map((x) => x.id); learn = true; title = `${u.title} 카드`; }
    } else if (mode === 'level') {
      const lv = App.C.levelById[id];
      if (lv) { ids = lv._vocab.concat(lv._kanji).filter((x) => !App.srs.has(x.id)).slice(0, 20).map((x) => x.id); learn = true; title = `${lv.name} 새 카드`; }
    } else if (mode === 'marks') {
      ids = util.shuffle(Object.keys(st.marks)); learn = true; title = '즐겨찾기 카드';
    }
    ids = ids.filter((x) => App.C.items[x]);
    const el = h('div.cards-page');
    const scr = { el, full: true, study: true };
    if (!ids.length) {
      el.appendChild(h('div.pad', App.ui.empty('🎉', mode === 'srs' ? '지금 복습할 카드가 없어요. 잘하고 있어요!' : '카드가 없어요.',
        h('button.btn.primary', { type: 'button', onclick: () => App.back() }, '돌아가기'))));
      return scr;
    }
    const queue = learn ? util.shuffle(ids) : ids.slice();
    let i = 0, flipped = false, reviewed = 0, again = 0, reverse = false;
    const startAt = Date.now();
    const bar = App.ui.bar(0, 'lesson-bar');
    const countEl = h('div.cards-count');
    const head = h('div.lesson-head', h('button.icon-btn', { type: 'button', onclick: () => App.back() }, '✕'), bar, countEl);
    const stage = h('div.card-stage');
    const controls = h('div.card-controls');
    const opts = h('div.row.gap.center-row.small',
      h('label.toggle', h('input', { type: 'checkbox', onchange: (e) => { reverse = e.target.checked; show(); } }), '뜻 → 일본어'));
    el.append(head, h('div.cards-title', title), opts, stage, controls);

    function show() {
      flipped = false;
      const it = App.C.items[queue[i]];
      bar.firstChild.style.width = Math.round((i / queue.length) * 100) + '%';
      countEl.textContent = `${i + 1}/${queue.length}`;
      stage.innerHTML = '';
      const [front, back] = cardFaces(it, reverse);
      const card = h('div.flashcard', h('div.fc-inner', front, back));
      card.addEventListener('click', flip);
      enableSwipe(card);
      stage.appendChild(card);
      stage.appendChild(h('div.row.center-row', App.views.speakBtn(ttsOf(it), '🔊'), App.views.markBtn(it.id)));
      controls.innerHTML = '';
      controls.appendChild(h('button.btn.primary.block.big', { type: 'button', onclick: flip }, '정답 보기'));
      if (!reverse && it.t !== 'g' && st.settings.autoplay) setTimeout(() => App.tts.speak(ttsOf(it)), 250);
    }

    function flip() {
      if (flipped) return;
      flipped = true;
      const it = App.C.items[queue[i]];
      App.$('.flashcard', stage).classList.add('flipped');
      if (reverse || it.t === 'g') App.tts.speak(ttsOf(it));
      controls.innerHTML = '';
      if (learn) {
        controls.appendChild(h('div.grade-row',
          h('button.grade.again', { type: 'button', onclick: () => grade(0) }, h('b', '😵 몰라요'), h('small', '다시 보기')),
          h('button.grade.good', { type: 'button', onclick: () => grade(2) }, h('b', '😊 알아요'), h('small', '복습 등록'))));
      } else {
        controls.appendChild(h('div.grade-row',
          [[0, 'again', '다시'], [1, 'hard', '어려움'], [2, 'good', '좋음'], [3, 'easy', '쉬움']].map(([q, c, l]) =>
            h('button.grade.' + c, { type: 'button', onclick: () => grade(q) }, h('b', l), h('small', App.srs.previewLabel(it.id, q))))));
      }
    }

    function grade(q) {
      const id = queue[i];
      App.srs.grade(id, q);
      reviewed++;
      st.counters.reviews++;
      App.game.today().reviews++;
      App.game.recordAnswer(q > 0);
      if (q === 0) { again++; queue.push(id); }
      q > 0 ? App.sfx.tap() : App.native.vibrate(30);
      i++;
      if (i >= queue.length) done();
      else show();
    }

    function enableSwipe(card) {
      let x0 = null, dx = 0;
      card.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; dx = 0; }, { passive: true });
      card.addEventListener('touchmove', (e) => {
        if (x0 == null || !flipped) return;
        dx = e.touches[0].clientX - x0;
        card.style.transform = `translateX(${dx}px) rotate(${dx / 25}deg)`;
        card.classList.toggle('sw-good', dx > 60);
        card.classList.toggle('sw-bad', dx < -60);
      }, { passive: true });
      card.addEventListener('touchend', () => {
        if (flipped && Math.abs(dx) > 90) grade(dx > 0 ? 2 : 0);
        else card.style.transform = '';
        x0 = null;
      });
    }

    function done() {
      const xp = Math.min(30, Math.max(3, Math.round(reviewed * 0.6)));
      const got = App.game.addXp(xp, 'review');
      App.store.save();
      App.sfx.done();
      head.style.visibility = 'hidden';
      opts.remove();
      stage.innerHTML = '';
      controls.innerHTML = '';
      stage.appendChild(h('div.result',
        h('div.result-title', '🃏 복습 완료!'),
        h('div.result-cards',
          h('div.rcard.xp', h('div.rc-label', 'XP'), h('div.rc-val', `⚡ ${got}`)),
          h('div.rcard.acc', h('div.rc-label', '카드'), h('div.rc-val', `🃏 ${reviewed - again}`)),
          h('div.rcard.time', h('div.rc-label', '시간'), h('div.rc-val', `⏱ ${util.fmtClock((Date.now() - startAt) / 1000)}`))),
        h('p.center.muted', again ? `다시 본 카드 ${again}장 — 곧 다시 나와요.` : '모두 기억했어요! 대단해요 👏'),
        h('button.btn.primary.block', { type: 'button', onclick: () => App.leave() }, '완료')));
      scr.onBack = null;
    }

    scr.onBack = () => {
      if (reviewed === 0) return App.leave();
      App.ui.confirm(`지금까지 ${reviewed}장을 복습했어요. 그만할까요? (복습 결과는 저장돼요)`, { ok: '그만하기', cancel: '계속' }).then((ok) => { if (ok) { App.game.addXp(Math.round(reviewed * 0.5)); App.leave(); } });
    };
    scr.onMount = () => { App.native.keepScreenOn(true); show(); };
    scr.onLeave = () => App.native.keepScreenOn(false);
    return scr;
  };
})();
