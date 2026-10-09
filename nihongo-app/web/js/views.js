/* 공용 뷰 컴포넌트: 문법 카드, 단어 행, 한자 카드/상세, 즐겨찾기 버튼 */
'use strict';

App.views = (function () {
  const { h, util, jp } = App;
  const S = () => App.store.state;

  function speakBtn(text, label = '🔊', cls = '') {
    return h('button.icon-btn.spk' + (cls ? '.' + cls : ''), { type: 'button', 'aria-label': '듣기', onclick: (e) => { e.stopPropagation(); App.tts.speak(text); } }, label);
  }

  function markBtn(id) {
    const on = () => !!S().marks[id];
    const b = h('button.icon-btn.mark', { type: 'button', 'aria-label': '즐겨찾기' }, on() ? '★' : '☆');
    if (on()) b.classList.add('on');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (on()) delete S().marks[id];
      else { S().marks[id] = Date.now(); App.srs.add(id); }
      b.textContent = on() ? '★' : '☆';
      b.classList.toggle('on', on());
      App.store.save();
      App.ui.toast(on() ? '즐겨찾기에 추가했어요 (복습 카드에도 등록)' : '즐겨찾기에서 뺐어요');
    });
    return b;
  }

  function exampleRow(jpText, ko) {
    const koEl = h('div.ex-ko', ko);
    return h('div.example',
      h('div.ex-line', h('div.ex-jp', { lang: 'ja', html: jp.ruby(jpText), onclick: () => App.tts.speak(jpText) }), speakBtn(jpText)),
      koEl);
  }

  function grammarCard(g, { compact = false, open = false } = {}) {
    const card = h('div.gcard' + (open || compact ? '.open' : ''));
    const head = h('div.g-head',
      h('div.g-pat', { lang: 'ja', html: jp.ruby(g.p) }),
      h('div.g-mean', g.m),
      compact ? null : h('div.g-tools', markBtn(g.id), h('span.chev', '⌄')));
    const body = h('div.g-body');
    const fill = () => {
      if (body.childElementCount) return;
      body.append(
        h('div.g-form', h('span.tag', '접속'), h('span', { lang: 'ja', html: jp.ruby(g.f) })),
        h('div.g-exp', { html: g.e }),
        g.n && g.n.length ? h('ul.g-notes', g.n.map((n) => h('li', { html: '⚠️ ' + jp.ruby(n) }))) : null,
        h('div.g-sub', '예문'),
        h('div.examples', (g.ex || []).map((ex) => exampleRow(ex[0], ex[1]))),
        g.q && g.q.length ? miniQuiz(g) : null,
      );
      if (!S().viewed[g.id]) { S().viewed[g.id] = Date.now(); App.srs.add(g.id, 24 * 3600000); App.store.save(); }
    };
    if (open || compact) fill();
    head.addEventListener('click', () => {
      if (compact) return;
      card.classList.toggle('open');
      if (card.classList.contains('open')) fill();
    });
    card.append(head, body);
    return card;
  }

  function miniQuiz(g) {
    const box = h('div.mini-quiz', h('div.g-sub', '확인 문제'));
    g.q.forEach(([stem, opts, ans]) => {
      const q = h('div.mq');
      q.appendChild(h('div.mq-stem', { lang: 'ja', html: jp.ruby(stem).replace(/（　）/g, '<span class="blank">（　）</span>') }));
      const row = h('div.mq-opts');
      let answered = false;
      opts.forEach((o, i) => {
        const b = h('button.mq-opt', { type: 'button', lang: 'ja', html: jp.ruby(o) });
        b.addEventListener('click', () => {
          if (answered) return;
          answered = true;
          const ok = i === ans;
          b.classList.add(ok ? 'good' : 'bad');
          if (!ok) row.children[ans].classList.add('good');
          ok ? App.sfx.good() : App.sfx.bad();
          App.game.recordAnswer(ok);
          App.srs.touch(g.id, ok);
          if (ok) App.game.addXp(1);
        });
        row.appendChild(b);
      });
      q.appendChild(row);
      box.appendChild(q);
    });
    return box;
  }

  function vocabRow(v, { showUnit = false } = {}) {
    const learned = App.srs.has(v.id);
    const row = h('div.vrow' + (learned ? '.learned' : ''),
      h('div.v-main',
        h('div.v-word', { lang: 'ja' }, v.w, v.r !== v.w ? h('span.v-read', v.r) : null),
        h('div.v-mean', v.m, showUnit ? h('span.v-unit', ` · ${(App.C.unitById[v.unit] || {}).title || ''}`) : null)),
      h('div.v-tools', speakBtn(v.r), markBtn(v.id)));
    if (v.ex) {
      const exEl = h('div.v-ex.hidden', exampleRow(v.ex, v.exKo));
      row.appendChild(exEl);
      row.classList.add('has-ex');
      row.addEventListener('click', () => exEl.classList.toggle('hidden'));
    } else row.addEventListener('click', () => App.tts.speak(v.r));
    return row;
  }

  function kanjiTile(k) {
    const b = h('button.ktile' + (App.srs.has(k.id) ? '.learned' : ''), { type: 'button', onclick: () => kanjiSheet(k) },
      h('span.k-char', { lang: 'ja' }, k.c), h('span.k-ko', k.ko));
    return b;
  }

  function kanjiSheet(k) {
    App.ui.sheet((body) => {
      body.append(
        h('div.k-detail',
          h('div.k-big', { lang: 'ja' }, k.c),
          h('div.k-info',
            h('div.k-hun', k.ko),
            h('div.k-read', h('span.tag', '음독'), h('span', { lang: 'ja' }, k.on)),
            h('div.k-read', h('span.tag', '훈독'), h('span', { lang: 'ja' }, k.kun)))),
        h('div.g-sub', '대표 단어'),
        h('div.k-words', k.words.map((w) => h('div.k-word',
          h('span.kw-jp', { lang: 'ja', html: jp.ruby(w.w) }), h('span.kw-m', w.m || ''), speakBtn(jp.kana(w.w))))),
        kanjiWords(k),
        h('div.row.gap',
          h('button.btn.ghost.grow', { type: 'button', onclick: () => { App.ui.closeTop(); App.go('write/' + encodeURIComponent(k.c)); } }, '✍️ 쓰기 연습'),
          h('button.btn.primary.grow', { type: 'button', onclick: () => { App.srs.add(k.id); App.ui.toast('복습 카드에 추가했어요'); } }, '🔁 복습 추가'),
          markBtn(k.id)),
      );
      if (!App.srs.has(k.id)) App.srs.add(k.id, 24 * 3600000);
    }, { title: `한자 · ${k.c}` });
  }

  function itemSheet(it) {
    if (!it) return;
    if (it.t === 'k') return kanjiSheet(it);
    App.ui.sheet((body) => {
      if (it.t === 'v') {
        body.append(
          h('div.item-big', { lang: 'ja' }, it.w),
          it.r !== it.w ? h('div.item-read', { lang: 'ja' }, it.r) : null,
          h('div.item-mean', it.m),
          h('div.row.gap.center-row', speakBtn(it.r, '🔊 듣기', 'wide'), markBtn(it.id)),
          it.ex ? exampleRow(it.ex, it.exKo) : null,
          relatedBlock(it),
          levelTag(it));
      } else if (it.t === 'g') {
        body.append(grammarCard(it, { compact: true }), levelTag(it));
      } else if (it.t === 's') {
        body.append(exampleRow(it.jp, it.ko), levelTag(it));
      } else if (it.t === 'a') {
        body.append(h('div.item-big', { lang: 'ja' }, it.c), h('div.item-mean', `${it.ko} · ${it.ro}`),
          it.tip ? h('p.small', '💡 ' + it.tip) : null, h('div.row.gap.center-row', speakBtn(it.c, '🔊 듣기', 'wide'),
            h('button.btn.ghost', { type: 'button', onclick: () => { App.ui.closeTop(); App.go('write/' + encodeURIComponent(it.c)); } }, '✍️ 쓰기')));
      }
    }, { title: { v: '단어', g: '문법', s: '문장', a: '문자' }[it.t] || '' });
  }

  /* 관련 예문 자동 검색 (전체 예문·회화에서) */
  let plainCache = null;
  function relatedSents(v, max = 4) {
    if (!plainCache) plainCache = App.C.all.s.map((s) => [jp.plain(s.jp), s]);
    const w = v.w;
    const own = v.ex ? jp.plain(v.ex) : '';
    let re = null;
    if (jp.hasKanji(w) && /[うくぐすつぬぶむるい]$/.test(w) && w.length >= 2) {
      const stem = w.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(stem + '[ぁ-ん]');
    } else if (!jp.hasKanji(w) && [...w].length < 3) return [];
    const out = [];
    for (const [p, s] of plainCache) {
      if (p === own) continue;
      if (re ? re.test(p) : p.includes(w)) { out.push(s); if (out.length >= max) break; }
    }
    return out;
  }
  function relatedBlock(v) {
    const list = relatedSents(v);
    if (!list.length) return null;
    return h('div.related', h('div.g-sub', `🔗 이 단어가 쓰인 다른 예문 (${list.length})`), list.map((s) => exampleRow(s.jp, s.ko)));
  }
  function kanjiWords(k) {
    const vs = App.C.all.v.filter((v) => v.w.includes(k.c)).slice(0, 16);
    if (!vs.length) return null;
    return h('div.related', h('div.g-sub', `🔗 이 한자가 들어간 단어 (${vs.length}${vs.length >= 16 ? '+' : ''})`),
      h('div.ex-chips', vs.map((v) => h('button.ex-chip', { type: 'button', onclick: () => App.tts.speak(v.r) }, h('b', { lang: 'ja' }, v.w), h('small', `${v.r !== v.w ? v.r + ' · ' : ''}${v.m}`)))));
  }

  function levelTag(it) {
    const u = App.C.unitById[it.unit];
    const lv = App.C.levelById[it.lv];
    if (!u || !lv) return null;
    return h('button.link.small', { type: 'button', onclick: () => { App.ui.closeTop(); App.go('unit/' + u.id); } }, `📍 ${lv.name} · ${u.title} 단원으로`);
  }

  function itemLabel(it) {
    if (!it) return '';
    if (it.t === 'v') return `${it.w}${it.r !== it.w ? ' (' + it.r + ')' : ''} — ${it.m}`;
    if (it.t === 'k') return `${it.c} — ${it.ko}`;
    if (it.t === 'g') return `${jp.plain(it.p)} — ${it.m}`;
    if (it.t === 's') return jp.plain(it.jp);
    if (it.t === 'a') return `${it.c} — ${it.ko}`;
    return it.id;
  }

  return { speakBtn, markBtn, exampleRow, grammarCard, vocabRow, kanjiTile, kanjiSheet, itemSheet, itemLabel };
})();
