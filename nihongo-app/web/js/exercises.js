/* 연습 문제 엔진: 문제 생성기 + 화면 렌더러 + 채점 */
'use strict';

App.ex = (function () {
  const { h, util, jp } = App;
  const S = () => App.store.state;

  /* ───────── 공통 헬퍼 ───────── */
  const canListen = () => S().settings.listen && App.tts.supported && !(App.ex._noListenUntil > Date.now());
  const canSpeak = () => S().settings.speak && App.speech.supported && !(App.ex._noSpeakUntil > Date.now());

  function wordHtml(v, withReading = S().settings.furigana) {
    const showR = withReading && v.r !== v.w;
    return `<span class="jp" lang="ja">${util.esc(v.w)}</span>${showR ? `<small class="rd" lang="ja">${util.esc(v.r)}</small>` : ''}`;
  }
  function jpHtml(markup) { return `<span class="jp" lang="ja">${jp.ruby(markup)}</span>`; }

  function distract(pool, correct, key, n, fallback) {
    const ck = key(correct);
    let cand = util.uniq(pool.filter((x) => x !== correct && key(x) && key(x) !== ck), key);
    if (cand.length < n && fallback) cand = util.uniq(cand.concat(fallback.filter((x) => x !== correct && key(x) && key(x) !== ck)), key);
    return util.sample(cand, n);
  }

  const KANA_ROWS = {
    'か': 'が', 'き': 'ぎ', 'く': 'ぐ', 'け': 'げ', 'こ': 'ご', 'さ': 'ざ', 'し': 'じ', 'す': 'ず', 'せ': 'ぜ', 'そ': 'ぞ',
    'た': 'だ', 'ち': 'ぢ', 'つ': 'づ', 'て': 'で', 'と': 'ど', 'は': 'ば', 'ひ': 'び', 'ふ': 'ぶ', 'へ': 'べ', 'ほ': 'ぼ',
  };
  const DAKU_REV = Object.fromEntries(Object.entries(KANA_ROWS).map(([a, b]) => [b, a]));
  const O_ROW = 'おこそとのほもよろごぞどぼぽょ';
  const E_ROW = 'えけせてねへめれげぜでべぺ';
  // 실제 시험처럼 "그럴듯한 오답" 읽기 생성
  function perturbReading(r) {
    const out = new Set();
    const chars = [...r];
    // 장음 넣기/빼기
    for (let i = 0; i < chars.length; i++) {
      if ((O_ROW.includes(chars[i]) || E_ROW.includes(chars[i])) && (chars[i + 1] === 'う' || chars[i + 1] === 'い')) {
        out.add(chars.slice(0, i + 1).concat(chars.slice(i + 2)).join(''));
      } else if (O_ROW.includes(chars[i]) && chars[i + 1] !== 'う' && i < chars.length - 1) {
        out.add(chars.slice(0, i + 1).concat(['う'], chars.slice(i + 1)).join(''));
      }
    }
    // 촉음 넣기/빼기
    if (r.includes('っ')) out.add(r.replace('っ', ''));
    else if (chars.length >= 3) {
      const i = 1 + Math.floor(Math.random() * (chars.length - 2));
      if (/[かきくけこさしすせそたちつてとぱぴぷぺぽ]/.test(chars[i])) out.add(chars.slice(0, i).concat(['っ'], chars.slice(i)).join(''));
    }
    // 탁점 바꾸기
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      const alt = KANA_ROWS[c] || DAKU_REV[c];
      if (alt) { const x = chars.slice(); x[i] = alt; out.add(x.join('')); }
    }
    // 요음 크기
    if (/[ゃゅょ]/.test(r)) out.add(r.replace(/[ゃゅょ]/, (m) => ({ 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ' }[m])));
    out.delete(r);
    return [...out];
  }

  const T = {
    meaning: '알맞은 뜻을 고르세요',
    word: '알맞은 일본어를 고르세요',
    reading: '밑줄 친 단어의 읽는 법은?',
    listen: '들리는 단어를 고르세요',
    listenS: '들리는 문장을 순서대로 만드세요',
    buildJa: '일본어로 번역하세요',
    buildKo: '한국어로 번역하세요',
    match: '짝을 맞추세요',
    kanji: '한자의 훈과 음은?',
    grammar: '（　）에 들어갈 알맞은 말은?',
    sentMean: '문장의 뜻으로 알맞은 것은?',
    speak: '소리 내어 읽어 보세요',
    kana: '이 글자는 어떻게 읽나요?',
    kanaPick: '알맞은 글자를 고르세요',
    notation: '알맞은 한자 표기는?',
  };

  /* ───────── 문제 생성기 ───────── */
  const gen = {
    vocabMeaning(v, pool) {
      const ds = distract(pool, v, (x) => x.m, 3, App.C.all.v);
      return {
        kind: 'choice', title: T.meaning, item: v.id, tts: v.r,
        q: { html: wordHtml(v), big: true, audio: v.r },
        opts: util.shuffle([v, ...ds]).map((x) => ({ html: util.esc(x.m), val: x.id })),
        ans: v.id, cols: 1,
        explain: `<b lang="ja">${util.esc(v.w)}</b> (${util.esc(v.r)}) — ${util.esc(v.m)}`,
      };
    },
    vocabWord(v, pool) {
      const ds = distract(pool, v, (x) => x.w + x.r, 3, App.C.all.v).filter((x) => x.m !== v.m);
      return {
        kind: 'choice', title: T.word, item: v.id, tts: v.r,
        q: { html: `<span class="ko-q">${util.esc(v.m)}</span>`, big: true },
        opts: util.shuffle([v, ...ds]).map((x) => ({ html: wordHtml(x), val: x.id, tts: x.r })),
        ans: v.id, cols: 2,
        explain: `<b lang="ja">${util.esc(v.w)}</b> (${util.esc(v.r)}) — ${util.esc(v.m)}`,
      };
    },
    vocabReading(v, pool) {
      if (!jp.hasKanji(v.w)) return null;
      const len = [...v.r].length;
      let fake = util.shuffle(perturbReading(v.r)).slice(0, 2);
      const real = pool.filter((x) => x !== v && x.r !== v.r && Math.abs([...x.r].length - len) <= 1 && jp.hasKanji(x.w)).map((x) => x.r);
      const opts = util.uniq([v.r, ...fake, ...util.shuffle(real)]).slice(0, 4);
      if (opts.length < 4) return null;
      return {
        kind: 'choice', title: T.reading, item: v.id, tts: v.r,
        q: { html: `<span class="jp u" lang="ja">${util.esc(v.w)}</span>`, big: true, sub: util.esc(v.m) },
        opts: util.shuffle(opts).map((r) => ({ html: `<span class="jp" lang="ja">${util.esc(r)}</span>`, val: r })),
        ans: v.r, cols: 2,
        explain: `<b lang="ja">${util.esc(v.w)}</b> = <span lang="ja">${util.esc(v.r)}</span> (${util.esc(v.m)})`,
      };
    },
    vocabListen(v, pool) {
      if (!canListen()) return null;
      const ds = distract(pool, v, (x) => x.r, 3, App.C.all.v);
      return {
        kind: 'choice', title: T.listen, item: v.id, tts: v.r, listen: true,
        q: { audio: v.r, hideText: true },
        opts: util.shuffle([v, ...ds]).map((x) => ({ html: wordHtml(x, true), val: x.id })),
        ans: v.id, cols: 2,
        explain: `<b lang="ja">${util.esc(v.w)}</b> (${util.esc(v.r)}) — ${util.esc(v.m)}`,
      };
    },
    vocabNotation(v, pool) {
      if (!jp.hasKanji(v.w)) return null;
      const len = [...v.w].length;
      const ds = util.uniq(pool.filter((x) => x !== v && x.w !== v.w && jp.hasKanji(x.w) && Math.abs([...x.w].length - len) <= 1), (x) => x.w);
      if (ds.length < 3) return null;
      return {
        kind: 'choice', title: T.notation, item: v.id, tts: v.r,
        q: { html: `<span class="jp u" lang="ja">${util.esc(v.r)}</span>`, big: true, sub: util.esc(v.m) },
        opts: util.shuffle([v, ...util.sample(ds, 3)]).map((x) => ({ html: `<span class="jp" lang="ja">${util.esc(x.w)}</span>`, val: x.id })),
        ans: v.id, cols: 2,
        explain: `<span lang="ja">${util.esc(v.r)}</span> = <b lang="ja">${util.esc(v.w)}</b> (${util.esc(v.m)})`,
      };
    },
    match(list) {
      const items = util.uniq(list, (x) => x.m).slice(0, 5);
      if (items.length < 3) return null;
      return {
        kind: 'match', title: T.match,
        pairs: items.map((x) => ({
          id: x.id,
          left: { html: x.t === 'a' ? `<span class="jp" lang="ja">${x.c}</span>` : wordHtml(x, false), tts: x.t === 'a' ? x.c : x.r || x.w },
          right: { html: util.esc(x.t === 'a' ? `${x.ko} (${x.ro})` : x.t === 'k' ? x.ko : x.m) },
        })),
      };
    },
    kanjiMeaning(k, pool) {
      const ds = distract(pool, k, (x) => x.ko, 3, App.C.all.k);
      return {
        kind: 'choice', title: T.kanji, item: k.id,
        q: { html: `<span class="jp kanji-big" lang="ja">${k.c}</span>`, big: true },
        opts: util.shuffle([k, ...ds]).map((x) => ({ html: util.esc(x.ko), val: x.id })),
        ans: k.id, cols: 2,
        explain: `<b lang="ja">${k.c}</b> ${util.esc(k.ko)} · 음: <span lang="ja">${util.esc(k.on)}</span> · 훈: <span lang="ja">${util.esc(k.kun)}</span>`,
      };
    },
    kanjiWord(k, pool) {
      const w = util.pick(k.words);
      const m = /^(.+?)\[(.+)\]$/.exec(w.w) || /^(.*)$/.exec(w.w);
      const word = jp.plain(w.w), read = jp.kana(w.w);
      if (!jp.hasKanji(word) || read === word) return null;
      const others = [];
      for (const kk of pool) for (const ww of kk.words) {
        const r = jp.kana(ww.w);
        if (r !== read && jp.plain(ww.w) !== word) others.push(r);
      }
      const opts = util.uniq([read, ...util.shuffle(perturbReading(read)).slice(0, 2), ...util.shuffle(others)]).slice(0, 4);
      if (opts.length < 4 || !m) return null;
      return {
        kind: 'choice', title: T.reading, item: k.id, tts: read,
        q: { html: `<span class="jp u" lang="ja">${util.esc(word)}</span>`, big: true, sub: util.esc(w.m || '') },
        opts: util.shuffle(opts).map((r) => ({ html: `<span class="jp" lang="ja">${util.esc(r)}</span>`, val: r })),
        ans: read, cols: 2,
        explain: `<b lang="ja">${util.esc(word)}</b> = <span lang="ja">${util.esc(read)}</span> (${util.esc(w.m || '')}) · ${k.c}: ${util.esc(k.ko)}`,
      };
    },
    grammarQuiz(g, qi) {
      const q = g.q && g.q[qi];
      if (!q) return null;
      const [stem, opts, ans] = q;
      const correct = opts[ans];
      const full = stem.replace(/（\s*）|（　）/, correct.replace(/\[[^\]]*\]/g, (x) => x));
      return {
        kind: 'choice', title: /（　）/.test(stem) ? T.grammar : '알맞은 것을 고르세요', item: g.id,
        tts: /（　）/.test(stem) && !/[가-힣]/.test(stem) ? full : null,
        q: { html: `<div class="stem">${jpHtml(stem).replace(/（　）/g, '<span class="blank">（　）</span>')}</div>` },
        opts: util.shuffle(opts.map((o, i) => ({ html: jpHtml(o), val: String(i) }))),
        ans: String(ans), cols: opts.some((o) => o.length > 8) ? 1 : 2,
        explain: `<b lang="ja">${jp.ruby(g.p)}</b> — ${util.esc(g.m)}`,
        grammar: g.id,
      };
    },
    sentMeaning(s, pool) {
      const ds = distract(pool, s, (x) => x.ko, 3, App.C.all.s);
      if (ds.length < 3) return null;
      return {
        kind: 'choice', title: T.sentMean, item: s.id, tts: s.jp,
        q: { html: `<div class="stem">${jpHtml(s.jp)}</div>`, audio: s.jp },
        opts: util.shuffle([s, ...ds]).map((x) => ({ html: util.esc(x.ko), val: x.id })),
        ans: s.id, cols: 1,
        explain: `${jpHtml(s.jp)}<br>${util.esc(s.ko)}`,
      };
    },
    buildJa(s, pool, listenOnly = false) {
      const ch = jp.chunks(s.jp);
      if (ch.length < 2 || ch.length > 9) return null;
      if (listenOnly && !canListen()) return null;
      const ansSet = new Set(ch.map(jp.norm));
      const extra = [];
      for (const o of util.shuffle(pool)) {
        if (o === s) continue;
        for (const c of jp.chunks(o.jp)) if (!ansSet.has(jp.norm(c)) && c.length <= 10) { extra.push(c); break; }
        if (extra.length >= Math.min(4, Math.max(2, 8 - ch.length))) break;
      }
      return {
        kind: 'build', lang: 'ja', title: listenOnly ? T.listenS : T.buildJa, item: s.id, tts: s.jp, listen: listenOnly,
        q: listenOnly ? { audio: s.jp, hideText: true } : { html: `<span class="ko-q">${util.esc(s.ko)}</span>` },
        tiles: util.shuffle(ch.concat(extra)).map((c) => ({ html: jp.ruby(c), val: c })),
        ans: ch,
        explain: `${jpHtml(s.jp)}<br><span class="muted">${util.esc(s.ko)}</span>`,
      };
    },
    buildKo(s, pool) {
      const words = s.ko.split(/\s+/).filter(Boolean);
      if (words.length < 2 || words.length > 9) return null;
      const ansSet = new Set(words.map(jp.normKo));
      const extra = [];
      for (const o of util.shuffle(pool)) {
        if (o === s) continue;
        const ws = o.ko.split(/\s+/).filter((w) => !ansSet.has(jp.normKo(w)));
        if (ws.length) extra.push(util.pick(ws));
        if (extra.length >= 3) break;
      }
      return {
        kind: 'build', lang: 'ko', title: T.buildKo, item: s.id, tts: s.jp,
        q: { html: `<div class="stem">${jpHtml(s.jp)}</div>`, audio: s.jp },
        tiles: util.shuffle(words.concat(util.uniq(extra))).map((w) => ({ html: util.esc(w), val: w })),
        ans: words,
        explain: `${jpHtml(s.jp)}<br>${util.esc(s.ko)}`,
      };
    },
    speak(s) {
      if (!canSpeak()) return null;
      const target = s.t === 'v' ? s.w : s.jp;
      const kana = s.t === 'v' ? s.r : jp.kana(s.jp);
      return {
        kind: 'speak', title: T.speak, item: s.id,
        jp: s.t === 'v' ? `${s.w}` : s.jp, ko: s.t === 'v' ? s.m : s.ko,
        target: jp.norm(target), targetKana: jp.norm(kana), tts: s.t === 'v' ? s.r : s.jp,
      };
    },
    kanaSound(a, pool) {
      const ds = distract(pool, a, (x) => x.ro, 3, App.C.all.a);
      return {
        kind: 'choice', title: T.kana, item: a.id, tts: a.c,
        q: { html: `<span class="jp kana-big" lang="ja">${a.c}</span>`, big: true, audio: a.c },
        opts: util.shuffle([a, ...ds]).map((x) => ({ html: `<b>${x.ko}</b> <small class="muted">${x.ro}</small>`, val: x.id })),
        ans: a.id, cols: 2,
        explain: `<b lang="ja">${a.c}</b> = ${a.ko} (${a.ro})${a.tip ? '<br><small>💡 ' + util.esc(a.tip) + '</small>' : ''}`,
      };
    },
    kanaPick(a, pool, listen = false) {
      if (listen && !canListen()) return null;
      const ds = distract(pool, a, (x) => x.c, 3, App.C.all.a);
      return {
        kind: 'choice', title: listen ? '들리는 글자를 고르세요' : T.kanaPick, item: a.id, tts: a.c, listen,
        q: listen ? { audio: a.c, hideText: true } : { html: `<span class="ko-q">${a.ko} <small>(${a.ro})</small></span>`, big: true },
        opts: util.shuffle([a, ...ds]).map((x) => ({ html: `<span class="jp kana-opt" lang="ja">${x.c}</span>`, val: x.id, tts: x.c })),
        ans: a.id, cols: 2,
        explain: `<b lang="ja">${a.c}</b> = ${a.ko} (${a.ro})`,
      };
    },
  };

  /* ───────── 레슨 구성 ───────── */
  function compose(list, max) {
    const out = list.filter(Boolean);
    return out.slice(0, max);
  }

  const build = {
    kana(chars, unit, max = 14) {
      const pool = unit.level._kana.length >= 8 ? unit.level._kana : App.C.all.a;
      const ex = [];
      const cs = util.shuffle(chars);
      cs.forEach((a, i) => {
        ex.push(gen.kanaSound(a, pool));
        if (i % 2 === 0) ex.push(gen.kanaPick(a, pool, true) || gen.kanaPick(a, pool));
        else ex.push(gen.kanaPick(a, pool));
      });
      const m1 = gen.match(util.sample(chars, 5));
      const words = unit._vocab.filter((v) => [...v.w].some((c) => chars.some((a) => a.c === c)));
      const wx = util.sample(words, 3).map((v) => gen.vocabMeaning(v, unit._vocab.length > 4 ? unit._vocab : App.C.all.v));
      let list = util.shuffle(ex).slice(0, max - 1 - wx.length);
      list.splice(Math.min(4, list.length), 0, m1);
      list = list.concat(wx);
      return compose(list, max);
    },
    vocab(vs, unit, max = 13) {
      const pool = unit.level._vocab;
      const out = [];
      const order = util.shuffle(vs);
      order.forEach((v, i) => {
        const kinds = ['vocabMeaning', 'vocabWord', 'vocabListen'];
        if (jp.hasKanji(v.w)) kinds.push('vocabReading');
        const k1 = kinds[i % kinds.length];
        out.push(gen[k1](v, pool) || gen.vocabMeaning(v, pool));
        if (i < 4) out.push(gen.vocabWord(v, pool));
      });
      let list = util.shuffle(out).slice(0, max - 2);
      const m = gen.match(util.sample(vs, 5));
      list.splice(Math.min(3, list.length), 0, m);
      const withEx = vs.filter((v) => v.ex);
      if (withEx.length) {
        const v = util.pick(withEx);
        const s = App.C.items['s:' + util.hash(v.ex)];
        if (s) list.push(gen.buildJa(s, unit.level._sent) || gen.sentMeaning(s, unit.level._sent));
      }
      return compose(list, max);
    },
    kanji(ks, unit, max = 12) {
      const pool = unit.level._kanji.length >= 6 ? unit.level._kanji : App.C.all.k;
      const out = [];
      util.shuffle(ks).forEach((k) => {
        out.push(gen.kanjiMeaning(k, pool));
        out.push(gen.kanjiWord(k, pool));
      });
      let list = util.shuffle(out.filter(Boolean)).slice(0, max - 1);
      list.splice(2, 0, gen.match(util.sample(ks, 5)));
      return compose(list, max);
    },
    grammar(gs, unit, max = 13) {
      const pool = unit.level._sent;
      const quiz = [];
      const sent = [];
      for (const g of gs) {
        (g.q || []).forEach((_, i) => quiz.push(gen.grammarQuiz(g, i)));
        for (const ex of g.ex || []) {
          const s = App.C.items['s:' + util.hash(ex[0])];
          if (!s) continue;
          const r = Math.random();
          sent.push(r < 0.45 ? gen.buildJa(s, pool) : r < 0.75 ? gen.buildKo(s, pool) : gen.sentMeaning(s, pool));
        }
      }
      const q = util.shuffle(quiz.filter(Boolean));
      const sn = util.shuffle(sent.filter(Boolean));
      const list = [];
      while (list.length < max && (q.length || sn.length)) {
        if (q.length) list.push(q.shift());
        if (sn.length && list.length < max) list.push(sn.shift());
      }
      return list;
    },
    sentences(ss, unit, max = 12) {
      const pool = unit.level._sent;
      const out = [];
      util.shuffle(ss).forEach((s, i) => {
        const opts = [gen.buildJa(s, pool, true), gen.buildKo(s, pool), gen.sentMeaning(s, pool), gen.buildJa(s, pool)];
        if (i % 3 === 0) opts.unshift(gen.speak(s));
        out.push(opts[i % opts.length] || opts.find(Boolean));
      });
      return compose(out, max);
    },
    review(unit, max = 16) {
      const parts = [];
      if (unit._kana.length) parts.push(...build.kana(unit._kana, unit, 8));
      if (unit._vocab.length && !unit._kana.length) parts.push(...build.vocab(util.sample(unit._vocab, 6), unit, 6));
      if (unit._kanji.length) parts.push(...build.kanji(util.sample(unit._kanji, 3), unit, 3));
      if (unit._grammar.length) parts.push(...build.grammar(unit._grammar, unit, 5));
      if (unit._sent.length) parts.push(...build.sentences(util.sample(unit._sent, 3), unit, 3));
      if (unit._kana.length && unit._vocab.length) parts.push(...util.sample(unit._vocab, 3).map((v) => gen.vocabMeaning(v, unit._vocab)));
      return compose(util.shuffle(parts.filter(Boolean)).filter((x) => x.kind !== 'match').concat([gen.match(util.sample(unit._kana.length ? unit._kana : unit._vocab, 5))]), max);
    },
    // 단원 테스트 (체계 코스) — 시험형, 균형 있게
    unitTest(unit, n = 20) {
      const lvPool = unit.level;
      const list = [];
      if (unit._kana.length) {
        for (const a of util.sample(unit._kana, 8)) list.push(gen.kanaSound(a, lvPool._kana));
        for (const a of util.sample(unit._kana, 4)) list.push(gen.kanaPick(a, lvPool._kana));
      }
      for (const v of util.sample(unit._vocab, unit._kana.length ? 6 : 7)) list.push(util.pick([gen.vocabMeaning, gen.vocabWord])(v, lvPool._vocab));
      for (const v of util.sample(unit._vocab.filter((x) => jp.hasKanji(x.w)), 3)) list.push(gen.vocabReading(v, lvPool._vocab));
      for (const k of util.sample(unit._kanji, 3)) list.push(util.pick([gen.kanjiMeaning, gen.kanjiWord])(k, lvPool._kanji.length > 5 ? lvPool._kanji : App.C.all.k));
      const gq = [];
      for (const g of unit._grammar) (g.q || []).forEach((_, i) => gq.push([g, i]));
      for (const [g, i] of util.sample(gq, 6)) list.push(gen.grammarQuiz(g, i));
      for (const s of util.sample(unit._sent, 3)) list.push(util.pick([gen.sentMeaning, gen.buildJa])(s, lvPool._sent));
      return util.shuffle(list.filter(Boolean)).slice(0, n);
    },
    // 오답/복습 퀴즈
    fromItems(ids, max = 15) {
      const out = [];
      for (const id of util.shuffle(ids)) {
        const it = App.C.items[id];
        if (!it) continue;
        const lv = App.C.levelById[it.lv];
        let e = null;
        if (it.t === 'v') e = util.pick([gen.vocabMeaning, gen.vocabWord, gen.vocabReading])(it, lv._vocab) || gen.vocabMeaning(it, lv._vocab);
        else if (it.t === 'k') e = gen.kanjiMeaning(it, lv._kanji.length > 5 ? lv._kanji : App.C.all.k);
        else if (it.t === 'g') e = gen.grammarQuiz(it, Math.floor(Math.random() * (it.q || []).length));
        else if (it.t === 's') e = gen.sentMeaning(it, lv._sent) || gen.buildJa(it, lv._sent);
        else if (it.t === 'a') e = gen.kanaSound(it, lv._kana.length > 5 ? lv._kana : App.C.all.a);
        if (e) out.push(e);
        if (out.length >= max) break;
      }
      return out;
    },
  };

  /* ───────── 렌더러 ───────── */
  function audioBtn(text, big = false, slow = false) {
    return h('button.audio-btn' + (big ? '.big' : '') + (slow ? '.slow' : ''), {
      type: 'button', 'aria-label': '듣기',
      onclick: (e) => { e.stopPropagation(); App.tts.speak(text, slow ? { rate: 0.55 } : {}); },
    }, slow ? '🐢' : '🔊');
  }

  function renderQ(q) {
    const box = h('div.ex-q' + (q.big ? '.big' : ''));
    if (q.audio && (q.hideText || canListen())) {
      const row = h('div.audio-row', audioBtn(q.audio, !!q.hideText), q.hideText ? audioBtn(q.audio, false, true) : null);
      box.appendChild(row);
    }
    if (!q.hideText && q.html) box.appendChild(h('div.q-main', { html: q.html }));
    if (q.sub) box.appendChild(h('div.q-sub', { html: q.sub }));
    return box;
  }

  function renderChoice(ex, mount, ctx) {
    mount.appendChild(renderQ(ex.q));
    const grid = h('div.opts' + (ex.cols === 2 ? '.cols2' : ''));
    ex._btns = [];
    ex.opts.forEach((o, i) => {
      const b = h('button.opt', { type: 'button', html: `<span class="num">${i + 1}</span><span class="lbl">${o.html}</span>` });
      b.addEventListener('click', () => {
        if (ex._locked) return;
        ex._btns.forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        App.sfx.tap();
        if (o.tts && canListen()) App.tts.speak(o.tts);
        ctx.setAnswer(o.val);
      });
      b._val = o.val;
      ex._btns.push(b);
      grid.appendChild(b);
    });
    mount.appendChild(grid);
    if (ex.q.audio && S().settings.autoplay && canListen()) setTimeout(() => App.tts.speak(ex.q.audio), 350);
    if (ex.listen) mount.appendChild(h('button.link.cant', { type: 'button', onclick: () => ctx.cantListen() }, '🔇 지금은 들을 수 없어요'));
  }

  function renderBuild(ex, mount, ctx) {
    mount.appendChild(renderQ(ex.q));
    const line = h('div.build-line' + (ex.lang === 'ja' ? '.ja' : ''));
    const bank = h('div.build-bank');
    const chosen = [];
    const sync = () => ctx.setAnswer(chosen.length ? chosen.map((t) => t.val) : null);
    ex.tiles.forEach((t) => {
      const ghost = h('span.tile.ghost', { html: t.html });
      const tile = h('button.tile' + (ex.lang === 'ja' ? '.ja' : ''), { type: 'button', html: t.html, lang: ex.lang === 'ja' ? 'ja' : 'ko' });
      const slot = h('span.slot', ghost, tile);
      bank.appendChild(slot);
      const entry = { val: t.val, tile, slot };
      tile.addEventListener('click', () => {
        if (ex._locked) return;
        App.sfx.tap();
        const idx = chosen.indexOf(entry);
        if (idx >= 0) {
          chosen.splice(idx, 1);
          slot.appendChild(tile);
        } else {
          chosen.push(entry);
          line.appendChild(tile);
          if (ex.lang === 'ja' && canListen()) App.tts.speak(t.val);
        }
        sync();
      });
    });
    mount.appendChild(h('div.build-area', line));
    mount.appendChild(bank);
    if (ex.q.audio && S().settings.autoplay && canListen()) setTimeout(() => App.tts.speak(ex.q.audio), 350);
    if (ex.listen) mount.appendChild(h('button.link.cant', { type: 'button', onclick: () => ctx.cantListen() }, '🔇 지금은 들을 수 없어요'));
  }

  function renderMatch(ex, mount, ctx) {
    const L = util.shuffle(ex.pairs.map((p) => ({ id: p.id, side: 'L', html: p.left.html, tts: p.left.tts })));
    const R = util.shuffle(ex.pairs.map((p) => ({ id: p.id, side: 'R', html: p.right.html })));
    let sel = null;
    let left = ex.pairs.length;
    ex._mistakes = 0;
    const grid = h('div.match');
    const colL = h('div.mcol'), colR = h('div.mcol');
    const mk = (o) => {
      const b = h('button.mbtn', { type: 'button', html: o.html });
      b.addEventListener('click', () => {
        if (b.classList.contains('done')) return;
        if (o.side === 'L' && o.tts && canListen()) App.tts.speak(o.tts);
        if (!sel || sel.o.side === o.side) {
          if (sel) sel.b.classList.remove('sel');
          sel = { o, b };
          b.classList.add('sel');
          App.sfx.tap();
          return;
        }
        if (sel.o.id === o.id) {
          sel.b.classList.remove('sel');
          sel.b.classList.add('done');
          b.classList.add('done');
          App.sfx.good();
          left--;
          sel = null;
          if (left === 0) setTimeout(() => ctx.complete(ex._mistakes === 0), 300);
        } else {
          ex._mistakes++;
          const a = sel.b;
          a.classList.add('wrong'); b.classList.add('wrong');
          App.sfx.bad();
          setTimeout(() => { a.classList.remove('wrong', 'sel'); b.classList.remove('wrong'); }, 450);
          sel = null;
        }
      });
      return b;
    };
    L.forEach((o) => colL.appendChild(mk(o)));
    R.forEach((o) => colR.appendChild(mk(o)));
    grid.append(colL, colR);
    mount.appendChild(grid);
  }

  function renderSpeak(ex, mount, ctx) {
    mount.appendChild(h('div.ex-q',
      h('div.audio-row', audioBtn(ex.tts), audioBtn(ex.tts, false, true)),
      h('div.q-main', { html: `<div class="stem">${jpHtml(ex.jp)}</div>` }),
      h('div.q-sub', ex.ko)));
    const status = h('div.speak-status', '마이크를 누르고 문장을 읽어 주세요');
    const mic = h('button.mic', { type: 'button' }, '🎤');
    mic.addEventListener('click', async () => {
      if (ex._locked) return;
      mic.classList.add('on');
      status.textContent = '듣고 있어요…';
      try {
        const res = await App.speech.listen('ja-JP');
        mic.classList.remove('on');
        let best = 0, bestText = res[0] || '';
        for (const r of res) {
          const n = jp.norm(r);
          const sc = Math.max(jp.similarity(n, ex.target), jp.similarity(jp.toHira(n), ex.targetKana));
          if (sc > best) { best = sc; bestText = r; }
        }
        ex._heard = bestText;
        ex._score = best;
        status.innerHTML = `인식 결과: <b lang="ja">${util.esc(bestText)}</b> · 일치도 ${Math.round(best * 100)}%`;
        S().counters.speak++;
        ctx.setAnswer({ score: best });
        ctx.submit();
      } catch (e) {
        mic.classList.remove('on');
        status.textContent = '음성을 인식하지 못했어요. 다시 시도하거나 건너뛰세요.';
      }
    });
    mount.appendChild(h('div.speak-box', mic, status));
    mount.appendChild(h('button.link.cant', { type: 'button', onclick: () => ctx.cantSpeak() }, '🙊 지금은 말할 수 없어요'));
  }

  function render(ex, mount, ctx) {
    ex._locked = false;
    mount.innerHTML = '';
    mount.appendChild(h('div.ex-title', ex.title));
    if (ex.kind === 'choice') renderChoice(ex, mount, ctx);
    else if (ex.kind === 'build') renderBuild(ex, mount, ctx);
    else if (ex.kind === 'match') renderMatch(ex, mount, ctx);
    else if (ex.kind === 'speak') renderSpeak(ex, mount, ctx);
  }

  function check(ex, answer) {
    ex._locked = true;
    if (ex.kind === 'choice') {
      const ok = String(answer) === String(ex.ans);
      (ex._btns || []).forEach((b) => {
        if (String(b._val) === String(ex.ans)) b.classList.add('good');
        else if (String(b._val) === String(answer)) b.classList.add('bad');
      });
      const right = ex.opts.find((o) => String(o.val) === String(ex.ans));
      return { ok, correct: right ? right.html : '' };
    }
    if (ex.kind === 'build') {
      const n = ex.lang === 'ja' ? jp.norm : jp.normKo;
      const ok = !!answer && n(answer.join('')) === n(ex.ans.join(''));
      return { ok, correct: ex.lang === 'ja' ? jpHtml(ex.ans.join(' ')) : util.esc(ex.ans.join(' ')) };
    }
    if (ex.kind === 'speak') {
      const ok = !!answer && answer.score >= 0.6;
      return { ok, correct: jpHtml(ex.jp) };
    }
    return { ok: true, correct: '' };
  }

  return {
    gen, build, render, check, canListen, canSpeak, wordHtml, jpHtml, perturbReading,
    _noListenUntil: 0, _noSpeakUntil: 0,
  };
})();
