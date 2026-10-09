/* 조사 마스터: 조사별 용법 정리 + 빈칸 연습 */
'use strict';

(function () {
  const { h, util, jp } = App;
  const LVI = { n5: 0, n4: 1, n3: 2, n2: 3, n1: 4 };
  const list = () => (window.JPDATA && JPDATA.particles) || [];
  const byP = (p) => list().find((x) => x.p === p);
  const jpHtml = (s) => App.ex.jpHtml(s);

  // TTS용: 빈칸 채우기, 한국어 메모·화자 표시 제거
  function spoken(stem, ans) {
    return stem.replace('（　）', ans).replace(/（[^）]*[가-힣][^）]*）/g, '').replace(/[AB][:：]\s*/g, '');
  }

  function exQuiz(P, q) {
    const [stem, ans, ko, wr] = q;
    const opts = util.uniq([ans].concat(String(wr || '').split(',').filter(Boolean)));
    return {
      kind: 'choice', title: '（　）에 들어갈 조사는?', tts: spoken(stem, ans),
      q: { html: `<div class="stem">${jpHtml(stem).replace(/（　）/g, '<span class="blank">（　）</span>')}</div>` },
      opts: util.shuffle(opts).map((o) => ({ html: `<span class="jp ptc-opt" lang="ja">${util.esc(o)}</span>`, val: o })), ans, cols: 2,
      explain: `${jpHtml(spoken(stem, ans))}<br>${util.esc(ko)}<br><small>💡 <b lang="ja">${util.esc(P.p)}</b> ${util.esc(P.name)} — ${util.esc(P.sum)}</small>`,
    };
  }
  function exUse(P, u, pool) {
    const others = util.sample(pool.filter((x) => x[3] !== u[3]), 3);
    if (others.length < 3) return null;
    return {
      kind: 'choice', title: '예문의 뜻으로 알맞은 것은?', tts: u[2],
      q: { html: `<div class="stem">${jpHtml(u[2])}</div>`, audio: u[2], sub: `<span lang="ja">${util.esc(P.p)}</span> · ${util.esc(u[0])}` },
      opts: util.shuffle([u].concat(others)).map((x) => ({ html: util.esc(x[3]), val: x[3] })), ans: u[3], cols: 1,
      explain: `${jpHtml(u[2])}<br>${util.esc(u[3])}<br><small>💡 ${util.esc(u[0])}: ${util.esc(u[1])}</small>`,
    };
  }

  App.drills.ptc = ([p = 'all', lv = 'n5']) => {
    const all = list();
    const usePool = all.flatMap((P) => P.uses);
    if (p !== 'all') {
      const P = byP(p);
      if (!P) return null;
      const qs = P.q.map((q) => exQuiz(P, q));
      const us = P.uses.map((u) => exUse(P, u, usePool)).filter(Boolean);
      // 같은 조사의 문제를 두 번 돌리되 보기 순서는 새로
      const listQ = util.shuffle(qs).concat(util.shuffle(us).slice(0, 3));
      while (listQ.length < 10) listQ.push(...util.shuffle(P.q.map((q) => exQuiz(P, q))));
      return { title: `조사 「${P.p}」 연습`, list: listQ.slice(0, 12), xp: 8 };
    }
    const max = LVI[lv] != null ? LVI[lv] : 0;
    const Ps = all.filter((P) => LVI[P.lv] <= max);
    const qs = util.shuffle(Ps.flatMap((P) => P.q.map((q) => [P, q]))).slice(0, 13).map(([P, q]) => exQuiz(P, q));
    const us = util.sample(Ps, 2).map((P) => exUse(P, util.pick(P.uses), usePool)).filter(Boolean);
    return { title: `조사 종합 연습 · ~${lv.toUpperCase()}`, list: util.shuffle(qs.concat(us)), xp: 12 };
  };

  App.screens.particles = function () {
    const el = h('div.pad');
    const all = list();
    el.appendChild(App.train.hero('🧷', '조사 마스터', `조사 ${all.length}개의 용법을 예문과 함께 정리했어요. 한국어와 다르게 쓰는 부분(に会う, が好き…)을 특히 주의!`));
    el.appendChild(h('div.section-title', '종합 연습'));
    const quick = h('div.menu-list');
    for (const [lv, d] of [['n5', '기본 조사 (は·が·を·に·で·へ·と·も·の…)'], ['n4', '+ しか·だけ·ばかり·ずつ·ほど·でも'], ['n3', '+ さえ, 모든 조사']]) {
      quick.appendChild(App.train.startRow(`조사 종합 · ~${lv.toUpperCase()}`, d, `lesson/drill/ptc/all/${lv}`, '⚡'));
    }
    el.appendChild(quick);
    el.appendChild(h('div.tip-box', h('b', '💡 헷갈리는 조사 비교'), h('p.small', 'は vs が, に vs で, まで vs までに 같은 비교는 「헷갈리는 문법」에서 따로 정리했어요.'),
      h('button.btn.ghost.block', { type: 'button', onclick: () => App.go('compare') }, '⚖️ 헷갈리는 문법 보기')));

    for (const lv of ['n5', 'n4', 'n3']) {
      const Ps = all.filter((P) => P.lv === lv);
      if (!Ps.length) continue;
      el.appendChild(h('div.section-title', `${lv.toUpperCase()} 조사`));
      for (const P of Ps) {
        const r = App.train.rec(`ptc/${P.p}`);
        el.appendChild(App.train.fold(h('div', h('div.g-pat', h('span.ptc-big', { lang: 'ja' }, P.p), ' ', h('small', P.name)), h('div.g-mean', P.sum)), (body) => {
          body.append(
            h('div.ptc-uses', P.uses.map(([name, desc, ex, ko], i) => h('div.ptc-use',
              h('div.pu-head', h('span.pu-n', String(i + 1)), h('b', name)),
              h('div.pu-desc', desc),
              App.views.exampleRow(ex, ko)))),
            h('div.g-sub', '빈칸 문제 미리 보기'),
            h('div.ptc-preview', P.q.slice(0, 2).map((q) => h('div.small', { lang: 'ja', html: jp.ruby(q[0]) }))),
            h('button.btn.primary.block', { type: 'button', onclick: () => App.go('lesson/drill/ptc/' + encodeURIComponent(P.p)) }, `▶ 「${P.p}」 집중 연습${r ? ` (최고 ${r.best}%)` : ''}`));
        }));
      }
    }
    return { el, title: '조사 마스터', back: true, tab: 'home', study: true };
  };
})();
