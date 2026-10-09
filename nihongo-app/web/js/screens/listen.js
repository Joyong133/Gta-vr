/* 청해 트레이닝: 받아쓰기·듣고 뜻 고르기·단어 듣기 / 쉐도잉 / 연속 듣기 */
'use strict';

(function () {
  const { h, util, jp } = App;
  const S = () => App.store.state;
  const LV = [['n5', 'N5'], ['n4', 'N4'], ['n3', 'N3'], ['n2', 'N2'], ['n1', 'N1']];

  function countListen(n = 1) {
    const st = S();
    st.counters.listen = (st.counters.listen || 0) + n;
    const d = App.game.today();
    d.listen = (d.listen || 0) + n;
    App.store.save();
  }
  App.listenCount = countListen;

  function sentPool(lv) {
    const L = App.C.levelById[lv] || App.C.levelById.n5;
    return L._sent.filter((s) => { const n = jp.chunks(s.jp).length; return n >= 2 && n <= 9 && jp.kana(s.jp).length <= 45; });
  }

  App.drills.lis = ([type = 'mix', lv = 'n5']) => {
    if (!App.ex.canListen()) return { empty: true, msg: '듣기 문제를 쓸 수 없어요. 설정에서 "듣기 문제"를 켜고, 일본어 음성(TTS)이 설치되어 있는지 확인해 주세요.' };
    const L = App.C.levelById[lv] || App.C.levelById.n5;
    const pool = sentPool(lv);
    const G = App.ex.gen;
    const out = [];
    let guard = 0;
    const kinds = { dict: ['dict'], mean: ['mean'], word: ['word'], mix: ['dict', 'mean', 'word', 'mean', 'dict'] }[type] || ['mix'];
    const seen = new Set();
    while (out.length < 15 && guard++ < 120) {
      const k = util.pick(kinds);
      let e = null;
      if (k === 'word') { const v = util.pick(L._vocab); if (v && !seen.has(v.id)) { seen.add(v.id); e = G.vocabListen(v, L._vocab); } }
      else {
        const s = util.pick(pool);
        if (!s || seen.has(s.id)) continue;
        seen.add(s.id);
        e = k === 'dict' ? G.buildJa(s, pool, true) : App.phraseEx.exListenMean(s, pool);
      }
      if (e) out.push(e);
    }
    const names = { dict: '받아쓰기', mean: '듣고 뜻 고르기', word: '단어 듣기', mix: '종합' };
    return { title: `청해 · ${names[type] || '종합'} (${L.name})`, list: out, xp: 12, onFinish: () => countListen(out.length) };
  };

  function lvOf() { const st = S(); return (st.train._lis && st.train._lis.lv) || (['n5', 'n4', 'n3', 'n2', 'n1'].includes(st.profile.target) ? st.profile.target : 'n5'); }

  /* ───────── 허브 ───────── */
  App.screens.listen = function () {
    const el = h('div.pad');
    const lv = lvOf();
    el.appendChild(App.train.hero('🎧', '청해 트레이닝', '귀를 일본어에 익숙하게! 받아쓰기 → 쉐도잉 → 연속 듣기 순서로 매일 10분이면 충분해요.'));
    if (!App.ex.canListen()) el.appendChild(h('div.tip-box', '⚠️ 지금은 음성을 쓸 수 없어요. 설정 → 듣기 문제 켜기, 일본어 TTS 설치를 확인해 주세요.'));
    el.appendChild(App.train.levelSeg(LV, lv, (x) => { S().train._lis = { lv: x, n: 0, best: 0 }; App.store.save(); App.rerender(); }));
    el.appendChild(h('div.section-title', '듣기 문제'));
    const m = h('div.menu-list');
    m.appendChild(App.train.startRow('받아쓰기', '듣고 어절 카드를 순서대로 놓기', `lesson/drill/lis/dict/${lv}`, '✍️'));
    m.appendChild(App.train.startRow('듣고 뜻 고르기', '글자 없이 소리만 듣고 의미 파악', `lesson/drill/lis/mean/${lv}`, '👂'));
    m.appendChild(App.train.startRow('단어 듣기', '들리는 단어 고르기', `lesson/drill/lis/word/${lv}`, '🔤'));
    m.appendChild(App.train.startRow('종합 청해', '위 유형 섞어서 15문제', `lesson/drill/lis/mix/${lv}`, '⚡'));
    el.appendChild(m);
    el.appendChild(h('div.section-title', '쉐도잉 · 연속 듣기'));
    const m2 = h('div.menu-list');
    m2.appendChild(h('button.menu-item', { type: 'button', onclick: () => App.go('shadow/' + lv) }, h('span.mi-i', '🗣️'), h('div.mi-b', h('div.mi-t', '쉐도잉'), h('div.mi-d', '한 문장씩 듣고 그림자처럼 따라 말하기 (발음 채점)')), h('span.mi-go', '›')));
    m2.appendChild(h('button.menu-item', { type: 'button', onclick: () => App.go('playlist/lv/' + lv) }, h('span.mi-i', '📻'), h('div.mi-b', h('div.mi-t', '연속 듣기 (라디오 모드)'), h('div.mi-d', '예문을 자동으로 이어서 재생 — 출퇴근길에')), h('span.mi-go', '›')));
    m2.appendChild(h('button.menu-item', { type: 'button', onclick: () => App.go('phrases') }, h('span.mi-i', '💬'), h('div.mi-b', h('div.mi-t', '상황별 회화 듣기'), h('div.mi-d', '식당·쇼핑·길 묻기 표현을 상황별로')), h('span.mi-go', '›')));
    el.appendChild(m2);
    el.appendChild(h('p.small.muted.center', `누적 들은 문장 ${S().counters.listen || 0}개 · 오늘 ${App.game.today().listen || 0}개`));
    el.appendChild(h('div.tip-box', h('b', '💡 쉐도잉 하는 법'), h('ul',
      h('li', '처음엔 텍스트를 보면서 2~3번 듣기'),
      h('li', '소리보다 0.5초 늦게 그림자처럼 따라 말하기'),
      h('li', '익숙해지면 텍스트를 가리고 소리만으로 따라 하기'),
      h('li', '🐢 천천히 → 보통 속도 순서로 올리기'))));
    return { el, title: '청해 트레이닝', back: true, tab: 'home', study: true };
  };

  /* ───────── 쉐도잉 ───────── */
  App.screens.shadow = function ([lv = 'n5']) {
    const pool = util.shuffle(sentPool(lv));
    const el = h('div.pad.shadow-page');
    if (!pool.length) { el.appendChild(App.ui.empty('📭', '문장이 없어요.')); return { el, title: '쉐도잉', back: true }; }
    let i = 0, showJp = true, showKo = false;
    const counted = new Set();
    const card = h('div.shadow-card');
    const status = h('div.speak-status');
    const render = () => {
      const s = pool[i];
      card.innerHTML = '';
      card.append(
        h('div.sd-num', `${i + 1} / ${pool.length} · ${(App.C.unitById[s.unit] || {}).title || ''}`),
        h('div.sd-jp' + (showJp ? '' : '.blur'), { lang: 'ja', html: jp.ruby(s.jp), onclick: (e) => e.currentTarget.classList.remove('blur') }),
        h('div.sd-ko' + (showKo ? '' : '.blur'), { onclick: (e) => e.currentTarget.classList.remove('blur') }, s.ko));
      status.textContent = '';
      if (!counted.has(s.id)) { counted.add(s.id); countListen(1); }
    };
    const play = (rate) => App.tts.speak(pool[i].jp, rate ? { rate } : {});
    const mic = App.speech.supported ? h('button.mic', { type: 'button', onclick: async () => {
      mic.classList.add('on');
      status.textContent = '듣고 있어요… 따라 말해 보세요';
      try {
        const res = await App.speech.listen('ja-JP');
        const target = jp.norm(pool[i].jp), tk = jp.norm(jp.kana(pool[i].jp));
        let best = 0, txt = res[0] || '';
        for (const r of res) { const n = jp.norm(r); const sc = Math.max(jp.similarity(n, target), jp.similarity(jp.toHira(n), tk)); if (sc > best) { best = sc; txt = r; } }
        S().counters.speak++;
        App.store.save();
        status.innerHTML = `${best >= 0.8 ? '🌟 훌륭해요!' : best >= 0.6 ? '👍 좋아요!' : '💪 한 번 더!'} <b lang="ja">${util.esc(txt)}</b> · 일치도 ${Math.round(best * 100)}%`;
        if (best >= 0.6) App.sfx.good(); else App.sfx.bad();
      } catch (e) { status.textContent = '음성을 인식하지 못했어요.'; }
      mic.classList.remove('on');
    } }, '🎤') : null;
    let auto = null;
    const stopAuto = () => { if (auto) { clearTimeout(auto); auto = null; autoBtn.textContent = '🔁 자동 쉐도잉'; } };
    const autoStep = (round) => {
      const s = pool[i];
      play();
      const ms = 900 + jp.kana(s.jp).length * 170 / (S().settings.ttsRate || 0.9);
      auto = setTimeout(() => {
        if (round < 2) autoStep(round + 1);
        else { i = (i + 1) % pool.length; render(); auto = setTimeout(() => autoStep(0), 700); }
      }, ms * 2);
    };
    const autoBtn = h('button.btn.ghost.grow', { type: 'button', onclick: () => { if (auto) stopAuto(); else { autoBtn.textContent = '⏸ 멈추기'; autoStep(0); } } }, '🔁 자동 쉐도잉');
    el.append(
      card,
      h('div.row.gap.center-row', h('button.audio-btn.big', { type: 'button', onclick: () => play() }, '🔊'), h('button.audio-btn.slow', { type: 'button', onclick: () => play(0.55) }, '🐢'), mic),
      status,
      h('div.row.gap.wrap',
        h('button.btn.ghost.grow', { type: 'button', onclick: () => { stopAuto(); i = (i - 1 + pool.length) % pool.length; render(); } }, '◀ 이전'),
        h('button.btn.primary.grow', { type: 'button', onclick: () => { stopAuto(); i = (i + 1) % pool.length; render(); play(); } }, '다음 ▶')),
      h('div.row.gap.wrap',
        h('button.btn.ghost.grow', { type: 'button', onclick: (e) => { showJp = !showJp; e.target.textContent = showJp ? '🙈 일본어 가리기' : '👀 일본어 보이기'; render(); } }, '🙈 일본어 가리기'),
        h('button.btn.ghost.grow', { type: 'button', onclick: (e) => { showKo = !showKo; e.target.textContent = showKo ? '🙈 뜻 가리기' : '🇰🇷 뜻 보이기'; render(); } }, '🇰🇷 뜻 보이기'),
        autoBtn),
      h('p.small.muted.center', '자동 쉐도잉: 같은 문장을 3번 들려주고, 사이사이 따라 말할 시간을 줘요.'));
    render();
    return { el, title: `쉐도잉 · ${lv.toUpperCase()}`, back: true, tab: 'home', study: true, onMount: () => { App.native.keepScreenOn(true); setTimeout(() => play(), 400); }, onLeave: () => { stopAuto(); App.native.keepScreenOn(false); } };
  };

  /* ───────── 연속 듣기 (라디오 모드) ───────── */
  App.screens.playlist = function ([src = 'lv', arg = 'n5']) {
    let items = [];
    let title = '연속 듣기';
    if (src === 'phr') {
      const sit = (JPDATA.phrases || []).find((x) => x.id === arg);
      if (sit) { items = App.phraseEx.toS(sit); title = `${sit.icon} ${sit.t}`; }
    } else if (src === 'unit') {
      const u = App.C.unitById[arg];
      if (u) { items = u._sent.slice(); title = u.title; }
    } else {
      items = util.shuffle(sentPool(arg)).slice(0, 40);
      title = `${arg.toUpperCase()} 예문 40`;
    }
    const el = h('div.pad.playlist');
    if (!items.length) { el.appendChild(App.ui.empty('📭', '재생할 문장이 없어요.')); return { el, title: '연속 듣기', back: true }; }
    const opt = Object.assign({ rate: 0.9, ko: true, rep: 1, text: true }, S().train._pl || {});
    const saveOpt = () => { S().train._pl = Object.assign({ n: 0, best: 0 }, opt); App.store.save(); };
    let cur = 0, playing = false, timer = null, token = 0;
    const listEl = h('div.pl-list');
    const nowEl = h('div.pl-now');
    const playBtn = h('button.btn.primary.big.grow', { type: 'button' }, '▶ 재생');
    const durJa = (t) => 700 + jp.kana(t).length * 165 / opt.rate;
    const durKo = (t) => 600 + t.length * 120;
    const wait = (ms, my) => new Promise((r) => { timer = setTimeout(() => r(my === token), ms); });

    function drawList() {
      listEl.innerHTML = '';
      items.forEach((s, i) => listEl.appendChild(h('div.pl-item' + (i === cur ? '.on' : ''), { onclick: () => { cur = i; if (playing) restart(); else { drawNow(); drawList(); } } },
        h('span.pl-n', String(i + 1)), h('div.pl-b', h('div.pl-jp' + (opt.text ? '' : '.blur'), { lang: 'ja', html: jp.ruby(s.jp) }), h('div.pl-ko.small.muted', s.ko)))));
    }
    function drawNow() {
      const s = items[cur];
      nowEl.innerHTML = '';
      nowEl.append(h('div.pl-count', `${cur + 1} / ${items.length}`), h('div.pl-big' + (opt.text ? '' : '.blur'), { lang: 'ja', html: jp.ruby(s.jp) }), h('div.pl-kobig', s.ko));
      const on = App.$('.pl-item.on', listEl);
      if (on) on.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    async function loop(my) {
      while (playing && my === token) {
        const s = items[cur];
        drawNow(); drawList();
        for (let r = 0; r < opt.rep; r++) {
          App.tts.speak(s.jp, { rate: opt.rate });
          if (!(await wait(durJa(s.jp), my))) return;
        }
        countListen(1);
        if (opt.ko) {
          App.tts.speak(s.ko, { lang: 'ko-KR', rate: 1 });
          if (!(await wait(durKo(s.ko), my))) return;
        }
        if (!(await wait(500, my))) return;
        cur = (cur + 1) % items.length;
      }
    }
    function start() { playing = true; token++; playBtn.textContent = '⏸ 일시정지'; App.native.keepScreenOn(true); loop(token); }
    function stop() { playing = false; token++; clearTimeout(timer); App.tts.stop(); playBtn.textContent = '▶ 재생'; App.native.keepScreenOn(false); }
    function restart() { stop(); start(); }
    playBtn.addEventListener('click', () => (playing ? stop() : start()));

    const seg = (label, choices, key) => h('div.pl-opt', h('span.small', label), h('div.seg', choices.map(([v, t]) => h('button.seg-btn' + (opt[key] === v ? '.on' : ''), { type: 'button', onclick: (e) => {
      opt[key] = v; saveOpt();
      App.$$('.seg-btn', e.target.parentNode).forEach((b) => b.classList.remove('on')); e.target.classList.add('on');
      if (key === 'text') { drawNow(); drawList(); }
    } }, t))));
    el.append(
      nowEl,
      h('div.row.gap',
        h('button.btn.ghost', { type: 'button', onclick: () => { cur = (cur - 1 + items.length) % items.length; playing ? restart() : (drawNow(), drawList()); } }, '⏮'),
        playBtn,
        h('button.btn.ghost', { type: 'button', onclick: () => { cur = (cur + 1) % items.length; playing ? restart() : (drawNow(), drawList()); } }, '⏭')),
      h('div.pl-opts',
        seg('속도', [[0.6, '🐢 0.6'], [0.8, '0.8'], [0.9, '0.9'], [1.0, '1.0']], 'rate'),
        seg('반복', [[1, '1번'], [2, '2번'], [3, '3번']], 'rep'),
        seg('한국어 뜻 읽기', [[true, '켜기'], [false, '끄기']], 'ko'),
        seg('글자', [[true, '보이기'], [false, '가리기']], 'text')),
      listEl);
    drawNow(); drawList();
    return { el, title, back: true, tab: 'home', study: true, onLeave: stop };
  };
})();
