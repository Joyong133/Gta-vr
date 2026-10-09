/* 동사·형용사 활용 트레이너 화면 */
'use strict';

(function () {
  const { h, util, jp } = App;
  const S = () => App.store.state;
  const C = () => App.conj;
  const LVS = [['n5', 'N5'], ['n4', '~N4'], ['n3', '~N3']];

  /* ───────── 연습 생성기 등록 ───────── */
  App.drills.conj = ([forms = 'auto', lv = 'n5']) => {
    const F = forms === 'auto' ? null : forms.split(',').filter((f) => C().FORM[f]);
    const names = F ? F.map((f) => C().FORM[f].name).join('·') : '전체 활용';
    return { title: `동사 활용 · ${names}`, list: C().drill({ kind: 'verb', forms: F, lv, n: 15 }), xp: 12 };
  };
  App.drills.vgroup = ([lv = 'n5']) => ({ title: '동사 그룹 판별', list: C().drill({ kind: 'verb', lv, only: 'group', n: 12 }), xp: 8 });
  App.drills.adj = ([forms = 'auto', lv = 'n5']) => {
    const F = forms === 'auto' ? null : forms.split(',').filter((f) => C().AFORM[f]);
    const names = F ? F.map((f) => C().AFORM[f].name).join('·') : '전체 활용';
    return { title: `형용사 활용 · ${names}`, list: C().drill({ kind: 'adj', forms: F, lv, n: 15 }), xp: 12 };
  };
  App.drills.atype = ([lv = 'n5']) => ({ title: 'い형용사 / な형용사 구별', list: C().drill({ kind: 'adj', lv, only: 'type', n: 12 }), xp: 8 });

  const VPRESETS = [
    ['ます형 4종', 'masu,masen,mashita,masendeshita', 'ます · ません · ました · ませんでした', 'n5'],
    ['て형 · た형', 'te,ta', '음편 규칙 (って·んで·いて·いで·して)', 'n5'],
    ['ない형 · なかった', 'nai,nakatta', 'あ단 + ない, 예외 ある → ない', 'n5'],
    ['たい · ている · ながら', 'tai,teiru,nagara', '희망·진행·동시 동작', 'n5'],
    ['가능형 · 의지형', 'pot,vol', '書ける / 食べられる · 書こう / 食べよう', 'n4'],
    ['가정형 ば · たら', 'ba,tara', '書けば · 書いたら', 'n4'],
    ['명령형 · 금지형', 'imp,proh', '書け / 食べろ · 書くな', 'n4'],
    ['수동 · 사역 · 사역수동', 'pass,caus,causpass', '書かれる · 書かせる · 書かされる', 'n4'],
    ['ず형', 'zu', '書かず · 食べず · せず · 来ず', 'n3'],
  ];
  const APRESETS = [
    ['부정 · 과거', 'neg,past,pastneg', '〜くない / 〜かった · 〜じゃない / 〜だった', 'n5'],
    ['정중형', 'polneg,polpast', '〜くないです · 〜かったです · 〜でした', 'n5'],
    ['て형 · 부사형 · 명사 수식', 'te,adv,attr', '〜くて / 〜で · 〜く / 〜に · 〜な', 'n5'],
    ['〜なる · 가정형', 'naru,ba,tara', '〜くなる / 〜になる · 〜ければ / 〜なら', 'n4'],
    ['そう · さ', 'sou,sa', 'おいしそう · よさそう · 高さ', 'n4'],
  ];

  function lvPick(key) {
    const st = S();
    st.train = st.train || {};
    return (st.train['_' + key] && st.train['_' + key].lv) || 'n5';
  }
  function setLv(key, lv) {
    const st = S();
    st.train['_' + key] = { lv, n: 0, best: 0 };
    App.store.save();
  }

  function formsChooser(all, lv, onStart) {
    const lvI = ['n5', 'n4', 'n3'].indexOf(lv);
    const sel = new Set(all.filter((f) => ['n5', 'n4', 'n3'].indexOf(f[3]) <= lvI).map((f) => f[0]).slice(0, 3));
    const box = h('div.chips');
    const startBtn = h('button.btn.primary.block', { type: 'button' }, '선택한 형태로 연습');
    const sync = () => { startBtn.disabled = !sel.size; startBtn.textContent = sel.size ? `선택한 ${sel.size}가지 형태로 연습` : '형태를 골라 주세요'; };
    for (const [k, name] of all) {
      const b = h('button.chip-t' + (sel.has(k) ? '.on' : ''), { type: 'button' }, name);
      b.addEventListener('click', () => { sel.has(k) ? sel.delete(k) : sel.add(k); b.classList.toggle('on', sel.has(k)); sync(); });
      box.appendChild(b);
    }
    startBtn.addEventListener('click', () => onStart([...sel]));
    sync();
    return h('div', box, startBtn);
  }

  /* ───────── 동사 활용 ───────── */
  App.screens.conj = function () {
    const el = h('div.pad');
    const lv = lvPick('conj');
    el.appendChild(App.train.hero('🔄', '동사 활용 트레이너', `${C().verbs.length}개 동사 × 22가지 활용형. 그룹 구별 → 규칙 → 연습 순서로 익혀요.`));
    el.appendChild(App.train.levelSeg(LVS, lv, (x) => { setLv('conj', x); App.rerender(); }));

    el.appendChild(h('div.section-title', '바로 연습'));
    const quick = h('div.menu-list');
    quick.appendChild(App.train.startRow('레벨 전체 활용 섞어서', `${lv.toUpperCase()}까지 배우는 모든 형태 15문제`, `lesson/drill/conj/auto/${lv}`, '⚡'));
    quick.appendChild(App.train.startRow('동사 그룹 판별', '1그룹·2그룹·3그룹, 예외 1그룹 동사', `lesson/drill/vgroup/${lv}`, '①'));
    for (const [t, forms, d, plv] of VPRESETS) {
      if (['n5', 'n4', 'n3'].indexOf(plv) > ['n5', 'n4', 'n3'].indexOf(lv)) continue;
      quick.appendChild(App.train.startRow(t, d, `lesson/drill/conj/${forms}/${lv}`, '▶'));
    }
    el.appendChild(quick);

    el.appendChild(h('div.section-title', '직접 골라서 연습'));
    el.appendChild(formsChooser(C().FORMS, lv, (sel) => App.go(`lesson/drill/conj/${sel.join(',')}/${lv}`)));

    el.appendChild(h('div.section-title', '동사 그룹 구별법'));
    el.appendChild(App.train.fold(h('div', h('div.g-pat', '1그룹 · 2그룹 · 3그룹'), h('div.g-mean', '활용 전에 반드시 알아야 할 첫 단계')), (body) => {
      body.append(
        h('div.g-exp', { html: `
          <p><b>3그룹 (불규칙)</b> — <span lang="ja">する</span>와 <span lang="ja">来[く]る</span> 단 2개 (+ <span lang="ja">勉強する</span>처럼 する가 붙은 말)</p>
          <p><b>2그룹 (1단)</b> — <span lang="ja">る</span>로 끝나고, <span lang="ja">る</span> 바로 앞이 <b>い단</b>(い·き·し·み·り…) 또는 <b>え단</b>(え·け·せ·べ·れ…)<br>예: <span lang="ja">見る(みる) · 起きる(おきる) · 食べる(たべる) · 寝る(ねる)</span></p>
          <p><b>1그룹 (5단)</b> — 나머지 전부. る 이외의 う단(う·く·ぐ·す·つ·ぬ·ぶ·む)으로 끝나거나, る 앞이 あ·う·お단<br>예: <span lang="ja">書く · 話す · 待つ · 分かる · 乗る</span></p>
          <p>⚠️ <b>예외 1그룹</b>: 모양은 2그룹인데 1그룹으로 활용하는 동사 — 꼭 외워 두세요!</p>`.replace(/([㐀-鿿]+)\[([^\]]+)\]/g, '<ruby>$1<rt>$2</rt></ruby>') }),
        h('div.ex-chips', ['帰る|かえる|돌아가다', '入る|はいる|들어가다', '走る|はしる|달리다', '知る|しる|알다', '切る|きる|자르다', '要る|いる|필요하다', '減る|へる|줄다', '喋る|しゃべる|수다 떨다', '滑る|すべる|미끄러지다', '握る|にぎる|쥐다', '蹴る|ける|차다', '焦る|あせる|초조해하다', '限る|かぎる|한정하다', '混じる|まじる|섞이다'].map((x) => {
          const [w, r, m] = x.split('|');
          return h('button.ex-chip', { type: 'button', onclick: () => App.tts.speak(r) }, h('b', { lang: 'ja', html: jp.ruby(jp.align(w, r)) }), h('small', m));
        })),
        h('div.g-exp', { html: '<p>같은 읽기라도 그룹이 다를 수 있어요: <span lang="ja">帰る(かえる, 1그룹) → 帰ります</span> / <span lang="ja">変える(かえる, 2그룹) → 変えます</span> · <span lang="ja">切る(きる, 1그룹) → 切ります</span> / <span lang="ja">着る(きる, 2그룹) → 着ます</span></p>' }),
        h('button.btn.primary.block', { type: 'button', onclick: () => App.go(`lesson/drill/vgroup/${lv}`) }, '① 그룹 판별 연습하기'));
    }));

    el.appendChild(h('div.section-title', '활용형 사전 (규칙 · 예시 · 예문)'));
    const sample = ['書く', '話す', '食べる', 'する', '来る'].map((w) => C().verbs.find((v) => v.w === w)).filter(Boolean);
    for (const [k, name, ko, flv] of C().FORMS) {
      const R = C().RULES[k];
      el.appendChild(App.train.fold(h('div', h('div.g-pat', h('span.tag', flv.toUpperCase()), name), h('div.g-mean', ko)), (body) => {
        body.append(
          h('div.rule-rows',
            h('div.rule-row', h('span.rr-g', '1그룹'), h('span.rr-t', { html: jp.rubyRaw(R[0]) })),
            h('div.rule-row', h('span.rr-g', '2그룹'), h('span.rr-t', { html: jp.rubyRaw(R[1]) })),
            h('div.rule-row', h('span.rr-g', '3그룹'), h('span.rr-t', { html: jp.rubyRaw(R[2]) }))),
          h('div.conj-ex', sample.map((v) => {
            const x = C().verbForm(v, k);
            return x ? h('button.ce-item', { type: 'button', onclick: () => App.tts.speak(x.r) }, h('span.ce-d', { lang: 'ja' }, v.w), h('span.ce-a', '→'), h('span.ce-f', { html: C().disp(v, x) })) : null;
          })),
          App.views.exampleRow(R[3][0], R[3][1]),
          h('button.btn.primary.block', { type: 'button', onclick: () => App.go(`lesson/drill/conj/${k}/${lv === 'n5' && flv !== 'n5' ? flv : lv}`) }, `▶ ${name}만 집중 연습`));
      }));
    }

    el.appendChild(h('div.section-title', '동사 목록 · 활용표'));
    el.appendChild(listBlock(C().pool('verb', lv), (v) => verbSheet(v), (v) => `${C().groupOf(v).split(' ')[0]} · ${v.m}`));
    return { el, title: '동사 활용', back: true, tab: 'home', study: true };
  };

  function listBlock(items, open, sub) {
    const wrap = h('div');
    const input = h('input.search', { type: 'search', placeholder: '검색 (예: 食べる, 먹다, たべる)', autocomplete: 'off' });
    const list = h('div.item-list');
    const run = () => {
      const q = input.value.trim();
      const hq = jp.toHira(q);
      list.innerHTML = '';
      const res = items.filter((v) => !q || v.w.includes(q) || v.r.includes(hq) || v.m.includes(q));
      for (const v of res.slice(0, 200)) {
        list.appendChild(h('div.irow', { onclick: () => open(v) },
          h('span.it-label', { lang: 'ja', html: jp.ruby(C().markup(v)) }), h('span.it-n.small.muted', sub(v)), h('span.it-lv', v.lv.toUpperCase())));
      }
      if (!res.length) list.appendChild(App.ui.empty('🤔', '찾는 단어가 없어요.'));
    };
    input.addEventListener('input', util.debounce(run, 120));
    run();
    wrap.append(input, list);
    return wrap;
  }

  function verbSheet(v) {
    App.ui.sheet((body) => {
      body.append(
        h('div.item-big', { lang: 'ja', html: jp.ruby(C().markup(v)) }),
        h('div.item-mean', `${v.m} · ${C().groupOf(v)}`),
        h('p.small.center', { html: C().groupWhy(v) }),
        h('div.row.gap.center-row', App.views.speakBtn(v.r, '🔊 듣기', 'wide'),
          h('button.btn.ghost', { type: 'button', onclick: () => { App.ui.closeTop(); App.go('lesson/drill/conjv/' + encodeURIComponent(v.w)); } }, '▶ 이 동사로 연습')),
        h('div.conj-table', C().FORMS.map(([k, name, ko]) => {
          const x = C().verbForm(v, k);
          if (!x) return null;
          return h('div.ct-row', { onclick: () => App.tts.speak(x.r) },
            h('div.ct-name', h('b', name), h('small', ko)), h('div.ct-form', { html: C().disp(v, x) }), h('span.ct-spk', '🔊'));
        })));
    }, { title: `활용표 · ${v.w}` });
  }
  // 특정 동사 하나로 모든 형태 연습
  App.drills.conjv = ([w]) => {
    const v = C().verbs.find((x) => x.w === w);
    if (!v) return null;
    const list = [];
    const forms = util.shuffle(C().FORMS.map((f) => f[0]).filter((f) => C().verbForm(v, f)));
    for (const f of forms) {
      const e = util.pick([C().exPick, C().exPick, C().exBuild, C().exIdentify])(v, f, false) || C().exPick(v, f, false);
      if (e) list.push(e);
      if (list.length >= 14) break;
    }
    return { title: `${v.w} 활용 연습`, list, xp: 10 };
  };

  /* ───────── 형용사 활용 ───────── */
  App.screens.adj = function () {
    const el = h('div.pad');
    const lv = lvPick('adj');
    el.appendChild(App.train.hero('🎨', '형용사 활용 트레이너', `い형용사 ${C().adjs.filter((a) => a.t === 'i').length}개 · な형용사 ${C().adjs.filter((a) => a.t === 'na').length}개 × 13가지 활용`));
    el.appendChild(App.train.levelSeg(LVS, lv, (x) => { setLv('adj', x); App.rerender(); }));
    el.appendChild(h('div.section-title', '바로 연습'));
    const quick = h('div.menu-list');
    quick.appendChild(App.train.startRow('레벨 전체 활용 섞어서', '부정·과거·て형·정중형… 15문제', `lesson/drill/adj/auto/${lv}`, '⚡'));
    quick.appendChild(App.train.startRow('い형용사 / な형용사 구별', 'きれい·嫌い 같은 함정 포함', `lesson/drill/atype/${lv}`, '①'));
    for (const [t, forms, d, plv] of APRESETS) {
      if (['n5', 'n4', 'n3'].indexOf(plv) > ['n5', 'n4', 'n3'].indexOf(lv)) continue;
      quick.appendChild(App.train.startRow(t, d, `lesson/drill/adj/${forms}/${lv}`, '▶'));
    }
    el.appendChild(quick);
    el.appendChild(h('div.section-title', '직접 골라서 연습'));
    el.appendChild(formsChooser(C().AFORMS, lv, (sel) => App.go(`lesson/drill/adj/${sel.join(',')}/${lv}`)));

    el.appendChild(h('div.section-title', 'い형용사 vs な형용사'));
    el.appendChild(App.train.fold(h('div', h('div.g-pat', '두 종류 구별하기'), h('div.g-mean', '명사 앞에서 모양이 달라요')), (body) => {
      body.append(h('div.g-exp', { html: `
        <p><b>い형용사</b>: 기본형이 <span lang="ja">い</span>로 끝나고, 명사 앞에 그대로 붙어요. <span lang="ja">高い 山</span> (높은 산)</p>
        <p><b>な형용사</b>: 명사 앞에서 <span lang="ja">な</span>가 붙어요. <span lang="ja">静かな 町</span> (조용한 동네)</p>
        <p>⚠️ <span lang="ja">きれい · 嫌い · 有名 · 丁寧</span>처럼 い로 끝나도 <b>な형용사</b>인 말이 있어요. <span lang="ja">きれいくない ✕ → きれいじゃない ○</span></p>
        <p>⚠️ <span lang="ja">いい</span>는 활용할 때 <span lang="ja">よ</span>로 바뀌어요: <span lang="ja">よくない · よかった · よくて · よさそう</span></p>` }));
    }, { open: true }));

    el.appendChild(h('div.section-title', '활용표'));
    const iA = C().adjs.find((a) => a.w === '高い'), naA = C().adjs.find((a) => a.w === '静か'), ii = C().adjs.find((a) => a.w === 'いい');
    const tbl = h('div.conj-table.three',
      h('div.ct-row.head', h('div.ct-name', '형태'), h('div.ct-form', 'い (高い)'), h('div.ct-form', 'いい'), h('div.ct-form', 'な (静か)')),
      C().AFORMS.map(([k, name, ko]) => h('div.ct-row',
        h('div.ct-name', h('b', name), h('small', ko)),
        [iA, ii, naA].map((a) => { const x = C().adjForm(a, k); return h('div.ct-form', x ? { lang: 'ja', html: jp.ruby(C().markup(x)), onclick: () => App.tts.speak(x.r) } : {}, x ? null : '—'); }))));
    el.appendChild(tbl);

    el.appendChild(h('div.section-title', '규칙 정리'));
    for (const [k, name, ko, flv] of C().AFORMS) {
      const R = C().ARULES[k];
      el.appendChild(App.train.fold(h('div', h('div.g-pat', h('span.tag', flv.toUpperCase()), name), h('div.g-mean', ko)), (body) => {
        body.append(
          h('div.rule-rows',
            h('div.rule-row', h('span.rr-g', 'い형'), h('span.rr-t', { html: jp.rubyRaw(R[0]) })),
            h('div.rule-row', h('span.rr-g', 'な형'), h('span.rr-t', { html: jp.rubyRaw(R[1]) }))),
          App.views.exampleRow(R[2][0], R[2][1]),
          h('button.btn.primary.block', { type: 'button', onclick: () => App.go(`lesson/drill/adj/${k}/${lv === 'n5' && flv !== 'n5' ? flv : lv}`) }, `▶ ${name}만 집중 연습`));
      }));
    }
    el.appendChild(h('div.section-title', '형용사 목록'));
    el.appendChild(listBlock(C().pool('adj', lv), (a) => adjSheet(a), (a) => `${a.t === 'i' ? 'い' : 'な'} · ${a.m}`));
    return { el, title: '형용사 활용', back: true, tab: 'home', study: true };
  };

  function adjSheet(a) {
    App.ui.sheet((body) => {
      body.append(
        h('div.item-big', { lang: 'ja', html: jp.ruby(C().markup(a)) }),
        h('div.item-mean', `${a.m} · ${a.t === 'i' ? 'い형용사' : 'な형용사'}`),
        h('div.row.gap.center-row', App.views.speakBtn(a.r, '🔊 듣기', 'wide')),
        h('div.conj-table', C().AFORMS.map(([k, name, ko]) => {
          const x = C().adjForm(a, k);
          if (!x) return null;
          return h('div.ct-row', { onclick: () => App.tts.speak(x.r) },
            h('div.ct-name', h('b', name), h('small', ko)), h('div.ct-form', { lang: 'ja', html: jp.ruby(C().markup(x)) }), h('span.ct-spk', '🔊'));
        })));
    }, { title: `활용표 · ${a.w}` });
  }
})();
