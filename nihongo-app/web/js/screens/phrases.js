/* 상황별 회화 표현: 상황 목록 → 표현 카드 → 연습 */
'use strict';

(function () {
  const { h, util, jp } = App;
  const list = () => (window.JPDATA && JPDATA.phrases) || [];
  const G = () => App.ex.gen;
  const toS = (sit) => sit.p.map(([j, k, n]) => ({ t: 's', id: 'ph:' + util.hash(j), jp: j, ko: k, note: n || '', sit: sit.id }));
  const allS = () => list().flatMap(toS);

  // 한국어 상황 → 알맞은 일본어 표현 고르기
  function exPick(s, pool) {
    const others = util.sample(pool.filter((x) => x.ko !== s.ko && x.jp !== s.jp), 3);
    if (others.length < 3) return null;
    return {
      kind: 'choice', title: '이럴 때 일본어로?', tts: s.jp,
      q: { html: `<span class="ko-q">${util.esc(s.ko)}</span>`, big: true },
      opts: util.shuffle([s].concat(others)).map((x) => ({ html: App.ex.jpHtml(x.jp), val: x.id, tts: x.jp })), ans: s.id, cols: 1,
      explain: `${App.ex.jpHtml(s.jp)}<br>${util.esc(s.ko)}${s.note ? `<br><small>💡 ${util.esc(s.note)}</small>` : ''}`,
    };
  }
  function exListenMean(s, pool) {
    if (!App.ex.canListen()) return null;
    const ds = util.sample(pool.filter((x) => x.ko !== s.ko), 3);
    if (ds.length < 3) return null;
    return {
      kind: 'choice', title: '듣고 뜻을 고르세요', tts: s.jp, listen: true,
      q: { audio: s.jp, hideText: true },
      opts: util.shuffle([s].concat(ds)).map((x) => ({ html: util.esc(x.ko), val: x.id })), ans: s.id, cols: 1,
      explain: `${App.ex.jpHtml(s.jp)}<br>${util.esc(s.ko)}`,
    };
  }
  App.phraseEx = { exPick, exListenMean, toS, allS };

  function build(items, pool, n) {
    const makers = [
      (s) => exPick(s, pool), (s) => G().sentMeaning(s, pool), (s) => G().buildJa(s, pool), (s) => exListenMean(s, pool),
      (s) => G().buildJa(s, pool, true), (s) => G().buildKo(s, pool), (s) => G().speak(s),
    ];
    const out = [];
    const order = util.shuffle(items);
    let i = 0, guard = 0;
    while (out.length < n && guard++ < n * 8 && order.length) {
      const s = order[i % order.length];
      const e = makers[(i + Math.floor(i / order.length)) % makers.length](s);
      if (e) out.push(e);
      i++;
    }
    return out;
  }

  App.drills.phr = ([id = 'all']) => {
    const pool = allS();
    if (id === 'all') return { title: '상황별 회화 · 종합', list: build(util.sample(pool, 12), pool, 15), xp: 12 };
    const sit = list().find((x) => x.id === id);
    if (!sit) return null;
    return { title: `${sit.icon} ${sit.t} 표현 연습`, list: build(toS(sit), pool, 12), xp: 10 };
  };

  App.screens.phrases = function ([id]) {
    if (id) return situation(id);
    const el = h('div.pad');
    const all = list();
    el.appendChild(App.train.hero('🗣️', '상황별 회화 표현', `${all.length}가지 상황 · ${all.reduce((a, s) => a + s.p.length, 0)}개 표현. 일본에서 바로 쓰는 문장을 소리 내어 익혀요.`));
    el.appendChild(h('div.menu-list', App.train.startRow('모든 상황 섞어서', '15문제 · 뜻·표현 고르기·문장 조립·듣기', 'lesson/drill/phr/all', '⚡')));
    el.appendChild(h('div.section-title', '상황 선택'));
    el.appendChild(h('div.sit-grid', all.map((s) => {
      const r = App.train.rec('phr/' + s.id);
      return h('button.sit-card', { type: 'button', onclick: () => App.go('phrases/' + s.id) },
        h('div.sc-i', s.icon), h('div.sc-t', s.t), h('div.sc-n', `${s.p.length}개 · ${s.lv.toUpperCase()}`), r ? h('div.sc-r', `최고 ${r.best}%`) : null);
    })));
    return { el, title: '상황별 회화', back: true, tab: 'home', study: true };
  };

  function situation(id) {
    const sit = list().find((x) => x.id === id);
    if (!sit) return App.screens.phrases([]);
    const el = h('div.pad');
    let hideKo = false;
    el.appendChild(h('div.sit-hero', h('div.sh-i', sit.icon), h('div', h('div.sh-t', sit.t), h('div.small.muted', sit.tip))));
    const box = h('div.phrase-list');
    const draw = () => {
      box.innerHTML = '';
      for (const s of toS(sit)) {
        const ko = h('div.ph-ko' + (hideKo ? '.blur' : ''), s.ko);
        ko.addEventListener('click', (e) => { e.stopPropagation(); ko.classList.remove('blur'); });
        box.appendChild(h('div.phrase', { onclick: () => App.tts.speak(s.jp) },
          h('div.ph-jp', { lang: 'ja', html: jp.ruby(s.jp) }),
          ko,
          s.note ? h('div.ph-note', '💡 ' + s.note) : null,
          h('div.ph-tools', App.views.speakBtn(s.jp), h('button.icon-btn', { type: 'button', 'aria-label': '천천히', onclick: (e) => { e.stopPropagation(); App.tts.speak(s.jp, { rate: 0.55 }); } }, '🐢'))));
      }
    };
    draw();
    el.appendChild(h('div.row.gap.wrap',
      h('button.btn.primary.grow', { type: 'button', onclick: () => App.go('lesson/drill/phr/' + sit.id) }, '▶ 연습하기'),
      h('button.btn.ghost.grow', { type: 'button', onclick: () => App.go('playlist/phr/' + sit.id) }, '🎧 연속 듣기'),
      h('button.btn.ghost.grow', { type: 'button', onclick: (e) => { hideKo = !hideKo; e.target.textContent = hideKo ? '🇰🇷 뜻 보이기' : '🙈 뜻 가리기'; draw(); } }, '🙈 뜻 가리기')));
    el.appendChild(box);
    return { el, title: `${sit.icon} ${sit.t}`, back: true, tab: 'home', study: true };
  }
})();
