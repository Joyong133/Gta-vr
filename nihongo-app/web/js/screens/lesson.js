/* 레슨 실행기: 챌린지 노드 / 단원 테스트 / 연습 / 복습 퀴즈 / 오답 / 건너뛰기 테스트 */
'use strict';

(function () {
  const { h, util, jp } = App;

  function setup(mode, id) {
    const S = App.store.state;
    const B = App.ex.build;
    switch (mode) {
      case 'node': {
        const n = App.path.byId(id);
        if (!n) return null;
        if (n.type === 'guide') return { title: n.label, pages: n.data, node: n, hearts: false, xp: n.xp };
        if (n.type === 'read') return { title: n.label, reading: n.data, node: n, hearts: false, xp: n.xp };
        return { title: `${n.unit.title} · ${n.label}`, list: App.path.exercises(n), node: n, hearts: S.settings.hearts, requeue: true, xp: n.xp };
      }
      case 'test': {
        const u = App.C.unitById[id];
        if (!u) return null;
        return { title: `${u.title} 단원 테스트`, list: B.unitTest(u), unit: u, test: true, xp: 20 };
      }
      case 'practice': {
        const u = App.C.unitById[id];
        if (!u) return null;
        const list = util.shuffle([].concat(
          u._kana.length ? B.kana(u._kana, u, 8) : [],
          u._vocab.length && !u._kana.length ? B.vocab(util.sample(u._vocab, 8), u, 7) : [],
          u._grammar.length ? B.grammar(u._grammar, u, 5) : [],
        )).slice(0, 14);
        return { title: `${u.title} 연습`, list, unit: u, requeue: true, xp: 8 };
      }
      case 'heal':
      case 'quiz': {
        let ids = App.srs.dueIds(15);
        if (ids.length < 8) ids = ids.concat(Object.keys(S.wrong).filter((x) => !ids.includes(x))).slice(0, 15);
        if (ids.length < 8) ids = ids.concat(util.sample(Object.keys(S.srs).filter((x) => !ids.includes(x)), 15 - ids.length));
        if (!ids.length) return { empty: true };
        return { title: mode === 'heal' ? '하트 회복 연습' : '퀴즈 복습', list: B.fromItems(ids, 12), heal: mode === 'heal', requeue: true, xp: 8 };
      }
      case 'wrong': {
        const ids = Object.entries(S.wrong).sort((a, b) => b[1].n - a[1].n).map(([k]) => k);
        if (!ids.length) return { empty: true };
        return { title: '오답 노트 퀴즈', list: B.fromItems(ids.slice(0, 20), 15), wrongMode: true, requeue: true, xp: 10 };
      }
      case 'skip': {
        const lv = App.C.levelById[id];
        if (!lv) return null;
        const units = lv.units.filter((u) => u._vocab.length || u._kana.length);
        const list = [];
        for (const u of units) list.push(...B.unitTest(u, 4).slice(0, Math.max(2, Math.ceil(24 / units.length))));
        return { title: `${lv.name} 건너뛰기 테스트`, list: util.shuffle(list).slice(0, 24), level: lv, test: true, skip: true, xp: 30 };
      }
      case 'mark': {
        const ids = Object.keys(S.marks);
        if (!ids.length) return { empty: true };
        return { title: '즐겨찾기 퀴즈', list: B.fromItems(ids, 15), requeue: true, xp: 8 };
      }
      default: return null;
    }
  }

  App.screens.lesson = function (args) {
    const [mode, id] = args;
    const cfg = setup(mode, id);
    const wrap = h('div.lesson');
    const scr = { el: wrap, full: true, study: true };

    if (!cfg || cfg.empty || (cfg.list && !cfg.list.length)) {
      wrap.append(h('div.pad', App.ui.empty('📭', cfg && cfg.empty ? '복습할 항목이 아직 없어요. 먼저 레슨을 학습해 보세요!' : '레슨을 불러오지 못했어요.',
        h('button.btn.primary', { type: 'button', onclick: () => App.back() }, '돌아가기'))));
      return scr;
    }
    if (cfg.hearts && App.game.hearts() <= 0) {
      setTimeout(() => outOfHearts(true), 50);
    }

    const state = {
      queue: cfg.list ? cfg.list.slice() : [],
      i: 0, total: cfg.list ? cfg.list.length : 0, correct: 0, answered: 0, mistakes: 0,
      combo: 0, maxCombo: 0, start: Date.now(), answer: null, phase: 'answer', wrongList: [], firstTry: new Set(),
    };

    /* 상단: 닫기, 진행바, 하트/콤보 */
    const progress = App.ui.bar(0, 'lesson-bar');
    const heartEl = h('div.lesson-hearts');
    const comboEl = h('div.combo');
    const head = h('div.lesson-head',
      h('button.icon-btn', { type: 'button', 'aria-label': '나가기', onclick: () => App.back() }, '✕'),
      progress, cfg.hearts ? heartEl : comboEl);
    const mount = h('div.ex-mount');
    const checkBtn = h('button.btn.primary.block.check', { type: 'button', disabled: true }, '확인');
    const skipBtn = h('button.btn.ghost.skip', { type: 'button' }, '건너뛰기');
    const foot = h('div.lesson-foot', h('div.foot-row', skipBtn, checkBtn));
    const feedback = h('div.feedback');
    wrap.append(head, h('div.lesson-body', mount), foot, feedback);

    const updateHead = () => {
      const doneN = cfg.test ? state.answered : state.correct;
      progress.firstChild.style.width = Math.round((doneN / Math.max(1, state.total)) * 100) + '%';
      if (cfg.hearts) heartEl.textContent = '❤️ ' + App.game.hearts();
      comboEl.textContent = state.combo >= 2 ? `🔥 ${state.combo}` : '';
    };

    const ctx = {
      setAnswer(v) { state.answer = v; checkBtn.disabled = v == null; },
      submit() { if (state.answer != null) doCheck(); },
      complete(ok) { finishMatch(ok); },
      cantListen() {
        App.ex._noListenUntil = Date.now() + 15 * 60000;
        App.ui.toast('15분 동안 듣기 문제를 건너뛸게요');
        skipCurrent();
      },
      cantSpeak() {
        App.ex._noSpeakUntil = Date.now() + 15 * 60000;
        App.ui.toast('15분 동안 말하기 문제를 건너뛸게요');
        skipCurrent();
      },
    };

    function cur() { return state.queue[state.i]; }

    function showPassage(r) {
      mount.innerHTML = '';
      const paras = r.jp.split('\n');
      const koParas = r.ko.split('\n');
      const box = h('div.passage');
      paras.forEach((p, i) => {
        box.appendChild(h('p.jp-para', { lang: 'ja', html: jp.ruby(p), onclick: () => App.tts.speak(p) }));
        box.appendChild(h('p.ko-para.hidden', koParas[i] || ''));
      });
      mount.append(
        h('div.ex-title', `📰 ${r.t}`),
        h('div.row.gap.wrap',
          h('button.btn.small.ghost', { type: 'button', onclick: () => App.tts.speak(r.jp.replace(/\n/g, '')) }, '🔊 전체 듣기'),
          h('button.btn.small.ghost', { type: 'button', onclick: () => App.$$('.ko-para', box).forEach((x) => x.classList.toggle('hidden')) }, '🇰🇷 번역 보기')),
        h('p.small.muted', '문단을 누르면 그 문단을 읽어 줘요.'),
        box,
      );
    }

    function renderCurrent() {
      state.answer = null;
      state.phase = 'answer';
      checkBtn.disabled = true;
      checkBtn.textContent = '확인';
      feedback.className = 'feedback';
      feedback.innerHTML = '';
      foot.style.display = '';
      skipBtn.style.display = cfg.test ? 'none' : '';
      updateHead();
      const ex = cur();
      if (!ex) return finish();
      if (ex.kind === 'page') {
        mount.innerHTML = '';
        mount.append(h('div.ex-title', ex.t), h('div.guide-page', { html: ex.h }));
        App.$$('.jp', mount).forEach((el) => { el.setAttribute('lang', 'ja'); el.addEventListener('click', () => App.tts.speak(el.textContent)); });
        checkBtn.disabled = false;
        checkBtn.textContent = state.i === state.queue.length - 1 ? '완료' : '다음';
        skipBtn.style.display = 'none';
        return;
      }
      if (ex.kind === 'passage') {
        showPassage(ex.r);
        checkBtn.disabled = false;
        checkBtn.textContent = '문제 풀기';
        skipBtn.style.display = 'none';
        return;
      }
      App.ex.render(ex, mount, ctx);
      if (ex.kind === 'match') foot.style.display = 'none';
      mount.scrollTop = 0;
    }

    function skipCurrent() {
      state.queue.splice(state.i, 1);
      state.total = Math.max(state.correct, state.total - 1);
      renderCurrent();
    }

    function afterAnswer(ok, ex, correctHtml) {
      state.answered++;
      App.game.recordAnswer(ok);
      if (ex.item) App.srs.touch(ex.item, ok);
      if (ok) {
        state.correct++;
        state.combo++;
        state.maxCombo = Math.max(state.maxCombo, state.combo);
        App.sfx.good();
        if (cfg.wrongMode && ex.item && !state.firstTry.has(ex.item)) App.srs.clearWrong(ex.item);
      } else {
        state.mistakes++;
        state.combo = 0;
        App.sfx.bad();
        if (ex.item) state.firstTry.add(ex.item);
        state.wrongList.push({ ex, correctHtml });
        if (cfg.requeue) {
          const copy = Object.assign({}, ex, { _locked: false });
          if (copy.kind === 'choice') copy.opts = util.shuffle(copy.opts);
          if (copy.kind === 'build') copy.tiles = util.shuffle(copy.tiles);
          state.queue.push(copy);
        }
        if (cfg.hearts) App.game.loseHeart();
      }
      updateHead();
    }

    function showFeedback(ok, ex, correctHtml) {
      state.phase = 'feedback';
      const praise = ['훌륭해요!', '정답이에요!', '완벽해요!', '좋아요!', 'すごい!', '최고예요!'];
      const fb = h('div.fb-inner',
        h('div.fb-title', ok ? (state.combo >= 3 ? `🔥 ${state.combo}연속 정답!` : util.pick(praise)) : '아쉬워요, 정답은:'),
        !ok && correctHtml ? h('div.fb-answer', { html: correctHtml }) : null,
        ex.explain ? h('div.fb-explain', { html: ex.explain }) : null,
        h('div.fb-actions',
          ex.tts ? h('button.icon-btn', { type: 'button', 'aria-label': '듣기', onclick: () => App.tts.speak(ex.tts) }, '🔊') : null,
          ex.grammar ? h('button.btn.small.ghost', { type: 'button', onclick: () => showGrammar(ex.grammar) }, '📘 문법 설명') : null,
          h('button.btn.block' + (ok ? '.good' : '.danger'), { type: 'button', onclick: next }, '계속')),
      );
      feedback.innerHTML = '';
      feedback.appendChild(fb);
      feedback.className = 'feedback show ' + (ok ? 'ok' : 'no');
      foot.style.display = 'none';
      if (ex.tts && App.ex.canListen() && (ok || ex.kind !== 'speak')) setTimeout(() => App.tts.speak(ex.tts), 150);
    }

    function showGrammar(gid) {
      const g = App.C.items[gid];
      if (!g) return;
      App.ui.sheet((body) => body.appendChild(App.views.grammarCard(g, { compact: true })), { title: '문법 설명' });
    }

    function doCheck() {
      const ex = cur();
      if (!ex) return;
      if (ex.kind === 'page' || ex.kind === 'passage') {
        state.correct++;
        state.i++;
        return renderCurrent();
      }
      if (state.phase !== 'answer' || state.answer == null) return;
      const { ok, correct } = App.ex.check(ex, state.answer);
      afterAnswer(ok, ex, correct);
      showFeedback(ok, ex, correct);
    }

    function finishMatch(ok) {
      const ex = cur();
      state.answered++;
      state.correct++;
      if (!ok) state.mistakes += Math.min(1, ex._mistakes || 0);
      state.combo = ok ? state.combo + 1 : 0;
      for (const p of ex.pairs) App.srs.touch(p.id, true);
      next();
    }

    function next() {
      if (cfg.hearts && App.game.hearts() <= 0 && state.i < state.queue.length - 1) {
        outOfHearts(false);
        return;
      }
      state.i++;
      if (state.i >= state.queue.length) finish();
      else renderCurrent();
    }

    checkBtn.addEventListener('click', doCheck);
    skipBtn.addEventListener('click', () => {
      const ex = cur();
      if (!ex || state.phase !== 'answer') return;
      const correct = ex.kind === 'choice' ? (ex.opts.find((o) => String(o.val) === String(ex.ans)) || {}).html : ex.kind === 'build' ? (ex.lang === 'ja' ? App.ex.jpHtml(ex.ans.join(' ')) : util.esc(ex.ans.join(' '))) : '';
      if (ex.kind === 'choice') App.ex.check(ex, '__skip__');
      afterAnswer(false, ex, correct);
      showFeedback(false, ex, correct);
    });

    function outOfHearts(atStart) {
      const S = App.store.state;
      App.ui.sheet((body, close) => {
        body.append(
          h('div.center', h('div.hearts-big', '💔'), h('h3', '하트를 모두 사용했어요'), h('p.muted', '잠시 쉬었다 오거나, 복습으로 하트를 회복하세요.')),
          h('div.col.gap',
            h('button.btn.primary.block', { type: 'button', disabled: S.gems < 350, onclick: () => { if (App.game.spendGems(350)) { App.game.gainHeart(5); close(); updateHead(); if (!atStart) { state.i++; state.i >= state.queue.length ? finish() : renderCurrent(); } } } }, `💎 350으로 회복 (보유 ${S.gems})`),
            h('button.btn.ghost.block', { type: 'button', onclick: () => { close(); scr.onBack = null; App.go('lesson/heal/x', true); } }, '🩺 복습해서 하트 얻기'),
            h('button.btn.ghost.block', { type: 'button', onclick: () => { close(); App.leave(); } }, '그만하기')),
        );
      }, { modal: true });
    }

    function finish() {
      const S = App.store.state;
      const secs = Math.round((Date.now() - state.start) / 1000);
      const firstTotal = cfg.list ? cfg.list.length : state.total;
      const graded = cfg.test ? state.answered : firstTotal;
      const acc = cfg.test
        ? Math.round((state.correct / Math.max(1, state.answered)) * 100)
        : Math.round((Math.max(0, graded - state.mistakes) / Math.max(1, graded)) * 100);
      const perfect = state.mistakes === 0 && state.answered > 0;
      let xp = cfg.xp || 10;
      let gems = 0;
      const notes = [];
      if (perfect && !cfg.pages) { xp += 5; notes.push('💯 실수 없음 +5 XP'); S.counters.perfect++; }
      if (state.maxCombo >= 8) { xp += 3; notes.push(`🔥 최대 콤보 ${state.maxCombo} +3 XP`); }
      let passed = null;
      if (cfg.test) {
        passed = acc >= 80;
        if (cfg.unit) {
          const c = (S.course[cfg.unit.id] = S.course[cfg.unit.id] || { seen: {} });
          const first = !c.done && passed;
          c.test = Math.max(c.test || 0, acc);
          if (passed) c.done = true;
          if (first) { gems += 15; notes.push('🎓 단원 통과 보상 💎15'); }
          if (!passed) xp = 5;
          App.srs.addMany([].concat(cfg.unit._vocab, cfg.unit._kanji, cfg.unit._grammar, cfg.unit._kana).map((x) => x.id));
        }
        if (cfg.skip) {
          if (passed) { S.skipped[cfg.level.id] = true; gems += 20; notes.push(`🚀 ${cfg.level.name} 전체 잠금 해제!`); }
          else xp = 5;
        }
      }
      if (cfg.node) {
        const p = (S.path[cfg.node.id] = S.path[cfg.node.id] || { n: 0, best: 0 });
        p.n++;
        p.best = Math.max(p.best, acc);
        p.ts = Date.now();
        S.lastNode = cfg.node.id;
        gems += p.n === 1 ? 5 : 1;
        App.srs.addMany(App.path.itemsOf(cfg.node));
      }
      if (cfg.heal) { App.game.gainHeart(1); notes.push('❤️ 하트 1개 회복'); }
      S.counters.lessons++;
      App.game.today().lessons++;
      S.gems += gems;
      const gained = App.game.addXp(xp, 'lesson');
      App.store.save();
      App.sfx.done();
      if (perfect || passed) App.ui.confetti();

      foot.style.display = 'none';
      feedback.className = 'feedback';
      head.style.visibility = 'hidden';
      mount.innerHTML = '';
      const title = cfg.test ? (passed ? '🎉 합격!' : '😢 조금만 더!') : perfect ? '🌟 완벽한 레슨!' : '🎉 레슨 완료!';
      const res = h('div.result',
        h('div.result-title', title),
        cfg.test ? h('p.center.muted', passed ? '80% 이상 정답으로 통과했어요.' : '80% 이상 맞혀야 통과예요. 틀린 문제를 복습하고 다시 도전해요!') : null,
        h('div.result-cards',
          h('div.rcard.xp', h('div.rc-label', '획득 XP'), h('div.rc-val', `⚡ ${gained}`)),
          h('div.rcard.acc', h('div.rc-label', cfg.test ? '점수' : '정확도'), h('div.rc-val', `🎯 ${acc}%`)),
          h('div.rcard.time', h('div.rc-label', '시간'), h('div.rc-val', `⏱ ${util.fmtClock(secs)}`))),
        notes.length ? h('div.result-notes', notes.map((n) => h('div', n))) : null,
        gems ? h('p.center', `💎 +${gems}`) : null,
        state.wrongList.length ? h('details.wrong-review',
          h('summary', `틀린 문제 다시 보기 (${state.wrongList.length})`),
          state.wrongList.map(({ ex, correctHtml }) => h('div.wr-item', h('div.wr-title', ex.title), ex.q && ex.q.html ? h('div.wr-q', { html: ex.q.html }) : null, h('div.wr-a', { html: '정답: ' + (correctHtml || '') }), ex.explain ? h('div.wr-ex.small', { html: ex.explain }) : null))) : null,
        h('div.col.gap',
          h('button.btn.primary.block', { type: 'button', onclick: () => App.leave() }, '계속하기'),
          cfg.test && !passed ? h('button.btn.ghost.block', { type: 'button', onclick: () => App.go(`lesson/${mode}/${id}`, true) }, '다시 도전') : null,
          cfg.node && cfg.node.type !== 'guide' && cfg.node.type !== 'read' ? h('button.btn.ghost.block', { type: 'button', onclick: () => App.go(`lesson/${mode}/${id}`, true) }, '한 번 더 연습') : null),
      );
      mount.appendChild(res);
      scr.onBack = null;
      App.native.keepScreenOn(false);
    }

    // 가이드(읽기) / 독해 레슨 구성
    if (cfg.pages) state.queue = cfg.pages.map((p) => ({ kind: 'page', t: p.t, h: p.h }));
    if (cfg.reading) {
      const r = cfg.reading;
      const passageHtml = r.jp.split('\n').map((p) => `<p lang="ja">${jp.ruby(p)}</p>`).join('');
      state.queue = [{ kind: 'passage', r }].concat((r.q || []).map(([q, opts, ans], i) => ({
        kind: 'choice', title: `문제 ${i + 1}`,
        q: { html: `<details class="mini-passage"><summary>본문 다시 보기</summary>${passageHtml}</details><div class="stem">${util.esc(q)}</div>` },
        opts: util.shuffle(opts.map((o, j) => ({ html: util.esc(o), val: String(j) }))), ans: String(ans), cols: 1,
        explain: util.esc(r.ko.split('\n').join(' ')),
      })));
    }
    if (cfg.pages || cfg.reading) state.total = state.queue.length;

    scr.onBack = () => {
      App.ui.confirm('지금 그만두면 이번 레슨의 진행 상황이 사라져요.', { ok: '그만두기', cancel: '계속 학습', danger: true }).then((yes) => { if (yes) App.leave(); });
    };
    scr.onMount = () => { App.native.keepScreenOn(true); renderCurrent(); };
    scr.onLeave = () => { App.native.keepScreenOn(false); };
    return scr;
  };
})();
