/* JLPT 모의고사: 문자·어휘 / 문법 / 독해 / 청해, 시간 제한, 과목별 점수, 합격 판정 */
'use strict';

(function () {
  const { h, util, jp } = App;
  const S = () => App.store.state;
  // 레벨별 합격선(180점 만점 환산) / 제한 시간(분)
  const SPEC = {
    n5: { pass: 80, min: 30 }, n4: { pass: 90, min: 35 }, n3: { pass: 95, min: 40 },
    n2: { pass: 90, min: 45 }, n1: { pass: 100, min: 50 },
  };

  App.screens.exam = function ([lvId]) {
    if (lvId && SPEC[lvId]) return runExam(lvId);
    const el = h('div.pad');
    el.appendChild(h('div.exam-hero', h('div.eh-icon', '📝'), h('div.eh-title', 'JLPT 실전 모의고사'),
      h('p.small', '실제 시험처럼 문자·어휘, 문법, 독해, 청해(듣기) 영역으로 출제하고 180점 만점으로 환산해 합격 여부를 알려 드려요. 매번 문제가 새로 섞여요.')));
    for (const id of ['n5', 'n4', 'n3', 'n2', 'n1']) {
      const lv = App.C.levelById[id];
      if (!lv) continue;
      const hist = S().exams.filter((e) => e.level === id);
      const best = hist.reduce((m, e) => Math.max(m, e.score), 0);
      el.appendChild(h('button.level-card', { type: 'button', style: { '--lv': lv.color }, onclick: () => start(id) },
        h('div.lc-badge', lv.name),
        h('div.lc-body', h('div.lc-title', `${lv.name} 모의고사`), h('div.lc-desc', `약 40문항 · ${SPEC[id].min}분 · 합격선 ${SPEC[id].pass}/180`),
          h('div.lc-stats', hist.length ? `응시 ${hist.length}회 · 최고 ${best}점 ${best >= SPEC[id].pass ? '✅' : ''}` : '아직 응시 기록 없음')),
        h('div.lc-pct', '›')));
    }
    if (S().exams.length) {
      el.appendChild(h('div.section-title', '최근 기록'));
      const list = h('div.item-list');
      for (const e of S().exams.slice(-10).reverse()) {
        list.appendChild(h('div.irow', h('span.it-type', e.level.toUpperCase()), h('span.it-label', `${e.date} · ${e.score}/180 ${e.pass ? '합격' : '불합격'}`),
          h('span.small.muted', e.parts.map((p) => `${p.name} ${p.ok}/${p.n}`).join(' · '))));
      }
      el.appendChild(list);
    }
    return { el, title: '모의고사', back: true, tab: 'more' };
  };

  function start(id) {
    App.ui.confirm(`<b>${id.toUpperCase()} 모의고사</b><br><br>· 제한 시간 ${SPEC[id].min}분<br>· 청해는 소리가 필요해요 🎧<br>· 중간에 나가면 기록되지 않아요<br><br>집중할 준비가 되었나요?`, { ok: '시작', cancel: '취소' })
      .then((ok) => { if (ok) App.go('exam/' + id); });
  }

  function makeExam(lv) {
    const G = App.ex.gen;
    const V = lv._vocab.filter((v) => v.w);
    const kanjiV = V.filter((v) => jp.hasKanji(v.w));
    const parts = [];
    // 1. 문자·어휘
    const vocabQ = [];
    for (const v of util.sample(kanjiV, 6)) vocabQ.push(Object.assign(G.vocabReading(v, V) || G.vocabMeaning(v, V), { sec: '漢字読み' }));
    for (const v of util.sample(kanjiV, 4)) { const e = G.vocabNotation(v, V); if (e) vocabQ.push(Object.assign(e, { sec: '表記' })); }
    for (const v of util.sample(V, 5)) vocabQ.push(Object.assign(G.vocabWord(v, V), { sec: '語彙' }));
    for (const k of util.sample(lv._kanji, 3)) vocabQ.push(Object.assign(G.kanjiMeaning(k, lv._kanji), { sec: '漢字' }));
    parts.push({ name: '문자·어휘', list: vocabQ.filter((x) => x && x.opts) });
    // 2. 문법
    const gq = [];
    for (const g of lv._grammar) (g.q || []).forEach((_, i) => gq.push([g, i]));
    const gram = util.sample(gq, 10).map(([g, i]) => Object.assign(G.grammarQuiz(g, i), { sec: '文法形式' }));
    const build = util.sample(lv._sent.filter((s) => s.src !== 'talk'), 3).map((s) => G.buildJa(s, lv._sent)).filter(Boolean).map((e) => Object.assign(e, { sec: '文の組み立て' }));
    parts.push({ name: '문법', list: gram.filter(Boolean).concat(build) });
    // 3. 독해
    const rd = [];
    for (const r of util.sample(lv._reading, 2)) {
      const passageHtml = r.jp.split('\n').map((p) => `<p lang="ja">${jp.ruby(p)}</p>`).join('');
      (r.q || []).forEach(([q, opts, ans]) => rd.push({
        kind: 'choice', title: `読解 · ${r.t}`, sec: '読解',
        q: { html: `<div class="exam-passage">${passageHtml}</div><div class="stem">${util.esc(q)}</div>` },
        opts: util.shuffle(opts.map((o, j) => ({ html: util.esc(o), val: String(j) }))), ans: String(ans), cols: 1,
        explain: util.esc(r.ko.replace(/\n/g, ' ')),
      }));
    }
    if (rd.length < 3) for (const s of util.sample(lv._sent, 3)) { const e = G.sentMeaning(s, lv._sent); if (e) rd.push(Object.assign(e, { sec: '読解', title: '문장의 의미' })); }
    parts.push({ name: '독해', list: rd });
    // 4. 청해 (TTS)
    const ls = [];
    if (App.tts.supported) {
      for (const s of util.sample(lv._sent, 6)) {
        const e = G.sentMeaning(s, lv._sent);
        if (!e) continue;
        e.q = { audio: s.jp, hideText: true };
        e.title = '音声を聞いて、意味を選んでください';
        e.sec = '聴解';
        ls.push(e);
      }
    }
    if (ls.length) parts.push({ name: '청해', list: ls });
    return parts;
  }

  App.examBuild = (id) => makeExam(App.C.levelById[id]);

  function runExam(id) {
    const lv = App.C.levelById[id];
    const parts = makeExam(lv);
    const flat = [];
    parts.forEach((p, pi) => p.list.forEach((e) => flat.push({ e, pi })));
    const answers = new Array(flat.length).fill(null);
    const limit = SPEC[id].min * 60;
    const t0 = Date.now();
    let i = 0;
    let timer = null;
    const el = h('div.exam-run');
    const scr = { el, full: true, study: true };
    const clock = h('div.exam-clock');
    const secEl = h('div.exam-sec');
    const head = h('div.lesson-head', h('button.icon-btn', { type: 'button', onclick: () => App.back() }, '✕'), secEl, clock);
    const mount = h('div.ex-mount');
    const prevBtn = h('button.btn.ghost', { type: 'button' }, '‹ 이전');
    const nextBtn = h('button.btn.primary.grow', { type: 'button' }, '다음 ›');
    const nav = h('div.exam-nav');
    el.append(head, nav, h('div.lesson-body', mount), h('div.lesson-foot', h('div.foot-row', prevBtn, nextBtn)));

    function drawNav() {
      nav.innerHTML = '';
      flat.forEach((_, k) => nav.appendChild(h('button.qdot' + (k === i ? '.cur' : '') + (answers[k] != null ? '.ans' : ''), { type: 'button', onclick: () => { i = k; show(); } }, String(k + 1))));
    }
    function show() {
      const { e, pi } = flat[i];
      secEl.innerHTML = `<b>${parts[pi].name}</b> <span class="muted">${e.sec || ''} · ${i + 1}/${flat.length}</span>`;
      const ctx = {
        setAnswer: (v) => { answers[i] = v; drawNav(); },
        submit() {}, complete() {}, cantListen() { answers[i] = '__skip__'; go(1); }, cantSpeak() {},
      };
      e._locked = false;
      if (e.kind === 'build') answers[i] = null; // 조립 문제는 다시 그리면 초기화됨
      App.ex.render(e, mount, ctx);
      // 이전 답 복원
      if (answers[i] != null && e.kind === 'choice') (e._btns || []).forEach((b) => b.classList.toggle('sel', String(b._val) === String(answers[i])));
      prevBtn.disabled = i === 0;
      nextBtn.textContent = i === flat.length - 1 ? '제출하기' : '다음 ›';
      drawNav();
      mount.scrollTop = 0;
    }
    function go(d) {
      if (i + d >= flat.length) return submit();
      i = Math.max(0, i + d);
      show();
    }
    prevBtn.addEventListener('click', () => go(-1));
    nextBtn.addEventListener('click', () => go(1));

    function tick() {
      const left = limit - (Date.now() - t0) / 1000;
      clock.textContent = '⏱ ' + util.fmtClock(left);
      clock.classList.toggle('warn', left < 300);
      if (left <= 0) { App.ui.toast('⏰ 시간 종료! 자동 제출합니다'); submit(true); }
    }

    async function submit(force) {
      if (!force) {
        const blank = answers.filter((a) => a == null).length;
        const ok = await App.ui.confirm(blank ? `아직 ${blank}문항을 풀지 않았어요. 제출할까요?` : '답안을 제출할까요?', { ok: '제출', cancel: '계속 풀기' });
        if (!ok) return;
      }
      clearInterval(timer);
      const res = parts.map((p) => ({ name: p.name, n: p.list.length, ok: 0 }));
      const review = [];
      flat.forEach(({ e, pi }, k) => {
        let ok = false;
        if (e.kind === 'choice') ok = String(answers[k]) === String(e.ans);
        else if (e.kind === 'build') ok = !!answers[k] && Array.isArray(answers[k]) && jp.norm(answers[k].join('')) === jp.norm(e.ans.join(''));
        if (ok) res[pi].ok++;
        if (e.item) App.srs.touch(e.item, ok);
        if (!ok) review.push({ e, k });
      });
      const totalN = res.reduce((a, r) => a + r.n, 0);
      const totalOk = res.reduce((a, r) => a + r.ok, 0);
      const score = Math.round((totalOk / Math.max(1, totalN)) * 180);
      // 과목별 기준점: 각 영역 정답률 30% 이상
      const sectionOk = res.every((r) => r.n === 0 || r.ok / r.n >= 0.3);
      const pass = score >= SPEC[id].pass && sectionOk;
      const st = S();
      st.exams.push({ level: id, score, max: 180, pass, date: util.dayKey(), parts: res, sec: Math.round((Date.now() - t0) / 1000) });
      st.counters.exams++;
      const xp = App.game.addXp(20 + Math.round(totalOk / 2), 'exam');
      App.store.save();
      App.game.checkAch();
      App.sfx.done();
      if (pass) App.ui.confetti();
      scr.onBack = null;
      el.innerHTML = '';
      el.appendChild(h('div.pad',
        h('div.result',
          h('div.result-title', pass ? '🎓 합격권입니다!' : '📚 조금 더 힘내요!'),
          h('div.exam-score', h('b', String(score)), h('span', ' / 180')),
          h('p.center.muted', `합격선 ${SPEC[id].pass}점 · 영역별 30% 이상 필요 · +${xp} XP`),
          h('div.part-bars', res.map((r) => h('div.pb', h('div.pb-head', h('span', r.name), h('span', `${r.ok}/${r.n}`)), App.ui.bar(r.n ? r.ok / r.n : 0, r.n && r.ok / r.n < 0.3 ? 'bad' : '')))),
          review.length ? h('details.wrong-review', h('summary', `틀린 문제 해설 (${review.length})`),
            review.map(({ e, k }) => h('div.wr-item',
              h('div.wr-title', `${k + 1}. ${e.title}`),
              e.q && e.q.html && !e.q.hideText ? h('div.wr-q', { html: e.q.html }) : e.q && e.q.audio ? h('div.wr-q', { lang: 'ja', html: '🔊 ' + jp.ruby(e.q.audio) }) : null,
              h('div.wr-a', { html: '정답: ' + (e.kind === 'choice' ? (e.opts.find((o) => String(o.val) === String(e.ans)) || {}).html : App.ex.jpHtml(e.ans.join(' '))) }),
              e.explain ? h('div.wr-ex.small', { html: e.explain }) : null))) : null,
          h('button.btn.primary.block', { type: 'button', onclick: () => App.go('exam', true) }, '확인'))));
    }

    scr.onBack = () => App.ui.confirm('시험을 중단할까요? 기록되지 않아요.', { ok: '중단', cancel: '계속', danger: true }).then((ok) => { if (ok) { clearInterval(timer); App.leave(); } });
    scr.onMount = () => { show(); tick(); timer = setInterval(tick, 1000); App.native.keepScreenOn(true); };
    scr.onLeave = () => { clearInterval(timer); App.native.keepScreenOn(false); };
    return scr;
  }
})();
