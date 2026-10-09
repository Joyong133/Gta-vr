/* 헷갈리는 문법 비교: 표로 정리 + 구별 문제 */
'use strict';

(function () {
  const { h, util, jp } = App;
  const LVI = { n5: 0, n4: 1, n3: 2, n2: 3, n1: 4 };
  const list = () => (window.JPDATA && JPDATA.compare) || [];
  const jpHtml = (s) => App.ex.jpHtml(s);
  const spoken = (stem, a) => jp.plain(stem.replace('（　）', a)).replace(/[AB][:：]\s*/g, '');

  function exQ(T, q) {
    const [stem, opts, ans, expl] = q;
    return {
      kind: 'choice', title: `${T.t}`, tts: spoken(stem, opts[ans]),
      q: { html: `<div class="stem">${jpHtml(stem).replace(/（　）/g, '<span class="blank">（　）</span>')}</div>` },
      opts: util.shuffle(opts.map((o, i) => ({ html: jpHtml(o), val: String(i) }))), ans: String(ans), cols: opts.some((o) => jp.plain(o).length > 6) ? 1 : 2,
      explain: `${jpHtml(stem.replace('（　）', opts[ans]))}<br>💡 ${util.esc(expl)}`,
    };
  }

  App.drills.cmp = ([id = 'all', lv = 'n5']) => {
    if (id !== 'all') {
      const T = list().find((x) => x.id === id);
      if (!T) return null;
      // 같은 문제를 보기 순서만 바꿔 한 번 더 풀어 확실히 굳히기
      const a = util.shuffle(T.q.map((q) => exQ(T, q)));
      const b = util.shuffle(T.q.map((q) => exQ(T, q)));
      return { title: `비교 · ${T.t}`, list: a.concat(b), xp: 8 };
    }
    const max = LVI[lv] != null ? LVI[lv] : 0;
    const Ts = list().filter((T) => LVI[T.lv] <= max);
    const qs = util.shuffle(Ts.flatMap((T) => T.q.map((q) => [T, q]))).slice(0, 15).map(([T, q]) => exQ(T, q));
    return { title: `헷갈리는 문법 종합 · ~${lv.toUpperCase()}`, list: qs, xp: 12 };
  };

  function topicBody(T, body) {
    body.append(
      h('div.cmp-rows', T.rows.map(([k, v]) => h('div.cmp-row', h('div.cr-k', { lang: 'ja', html: jp.rubyRaw(k) }), h('div.cr-v', { html: jp.rubyRaw(v) })))),
      T.pairs ? h('div.cmp-pairs',
        h('div.cp-row.head', (T.id === 'keigo' ? ['기본', '존경어', '겸양어'] : ['자동사', '타동사', '뜻']).map((x) => h('span', x))),
        T.pairs.map((p) => h('div.cp-row', p.map((x, i) => h('span', (T.id !== 'keigo' && i === 2) ? {} : { lang: 'ja', html: jp.ruby(x), onclick: () => App.tts.speak(jp.kana(x)) }, (T.id !== 'keigo' && i === 2) ? x : null))))) : null,
      T.tips && T.tips.length ? h('ul.g-notes', T.tips.map((t) => h('li', { html: '📌 ' + jp.rubyRaw(t) }))) : null,
      h('div.g-sub', '예문'),
      h('div.examples', T.ex.map(([a, b]) => App.views.exampleRow(a, b))),
      h('button.btn.primary.block', { type: 'button', onclick: () => App.go('lesson/drill/cmp/' + T.id) }, `▶ 구별 문제 ${T.q.length * 2}개 풀기`));
  }

  App.screens.compare = function (args) {
    const el = h('div.pad');
    const all = list();
    el.appendChild(App.train.hero('⚖️', '헷갈리는 문법 비교', `비슷해 보이는 표현 ${all.length}세트를 표로 비교하고, 바로 구별 문제로 확인해요.`));
    el.appendChild(h('div.section-title', '종합 연습'));
    const quick = h('div.menu-list');
    for (const lv of ['n5', 'n4', 'n3', 'n2']) {
      const n = all.filter((T) => LVI[T.lv] <= LVI[lv]).length;
      quick.appendChild(App.train.startRow(`~${lv.toUpperCase()} 비교 문법 섞어서`, `${n}세트에서 15문제`, `lesson/drill/cmp/all/${lv}`, '⚡'));
    }
    el.appendChild(quick);
    const focus = args && args[0];
    for (const lv of ['n5', 'n4', 'n3', 'n2', 'n1']) {
      const Ts = all.filter((T) => T.lv === lv);
      if (!Ts.length) continue;
      el.appendChild(h('div.section-title', `${lv.toUpperCase()}`));
      for (const T of Ts) {
        const r = App.train.rec('cmp/' + T.id);
        el.appendChild(App.train.fold(h('div', h('div.g-pat', { lang: 'ja' }, T.t, r ? h('span.tag.ok', `${r.best}%`) : null), h('div.g-mean', T.sum)), (body) => topicBody(T, body), { open: focus === T.id }));
      }
    }
    return { el, title: '헷갈리는 문법', back: true, tab: 'home', study: true };
  };
})();
