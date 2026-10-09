/* 50음도 표 + 쓰기 연습(따라 쓰기 · 간단 채점) */
'use strict';

(function () {
  const { h, util } = App;
  let script = 'hira';
  let hideRo = false;

  const GOJUON_ORDER = [
    ['あ', 'い', 'う', 'え', 'お'], ['か', 'き', 'く', 'け', 'こ'], ['さ', 'し', 'す', 'せ', 'そ'], ['た', 'ち', 'つ', 'て', 'と'],
    ['な', 'に', 'ぬ', 'ね', 'の'], ['は', 'ひ', 'ふ', 'へ', 'ほ'], ['ま', 'み', 'む', 'め', 'も'], ['や', '', 'ゆ', '', 'よ'],
    ['ら', 'り', 'る', 'れ', 'ろ'], ['わ', '', '', '', 'を'], ['ん', '', '', '', ''],
  ];

  function item(c) { return App.C.items['a:' + c]; }
  const toKata = (s) => s.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));

  function cell(it) {
    if (!it) return h('div.kc-empty');
    return h('button.kana-cell' + (App.srs.has(it.id) ? '.learned' : ''), { type: 'button', onclick: () => { App.tts.speak(it.c); App.views.itemSheet(it); } },
      h('span.kc', { lang: 'ja' }, it.c), hideRo ? null : h('span.kr', `${it.ko} · ${it.ro}`));
  }

  App.screens.kana = function () {
    const el = h('div.pad');
    el.appendChild(h('div.row.gap',
      h('div.seg.grow',
        h('button.seg-btn' + (script === 'hira' ? '.on' : ''), { type: 'button', onclick: () => { script = 'hira'; App.rerender(); } }, 'ひらがな'),
        h('button.seg-btn' + (script === 'kata' ? '.on' : ''), { type: 'button', onclick: () => { script = 'kata'; App.rerender(); } }, 'カタカナ')),
      h('label.toggle', h('input', { type: 'checkbox', checked: hideRo, onchange: (e) => { hideRo = e.target.checked; App.rerender(); } }), '발음 가리기')));
    el.appendChild(h('div.section-title', '청음 (五十音)'));
    const grid = h('div.gojuon');
    for (const row of GOJUON_ORDER) for (const c of row) grid.appendChild(cell(c ? item(script === 'hira' ? c : toKata(c)) : null));
    el.appendChild(grid);
    const groups = script === 'hira' ? [['탁음·반탁음', 'hiraDaku'], ['요음', 'hiraYoon']] : [['탁음·반탁음', 'kataDaku'], ['요음', 'kataYoon'], ['외래어 표기', 'kataExt']];
    for (const [t, g] of groups) {
      el.appendChild(h('div.section-title', t));
      const gg = h('div.kana-grid' + (g.includes('Yoon') || g === 'kataExt' ? '.yoon' : ''));
      for (const row of App.C.kanaGroups[g] || []) for (const it of row.chars) gg.appendChild(cell(it));
      el.appendChild(gg);
    }
    el.appendChild(h('button.btn.primary.block', { type: 'button', onclick: () => App.go('write/' + (script === 'hira' ? 'あ' : 'ア')) }, '✍️ 쓰기 연습하기'));
    return { el, title: '50음도', back: true, tab: 'more', study: true };
  };

  /* ───────── 쓰기 연습 ───────── */
  function sequenceFor(ch) {
    const a = item(ch);
    if (a) {
      const all = App.C.all.a.filter((x) => x.script === a.script && [...x.c].length === 1);
      return all.map((x) => x.c);
    }
    const k = App.C.items['k:' + ch];
    if (k) return App.C.levelById[k.lv]._kanji.map((x) => x.c);
    return App.C.all.a.filter((x) => x.script === 'hira' && [...x.c].length === 1).map((x) => x.c);
  }

  App.screens.write = function ([ch]) {
    ch = ch || 'あ';
    const seq = sequenceFor(ch);
    const idx = Math.max(0, seq.indexOf(ch));
    const info = item(ch) || App.C.items['k:' + ch];
    const el = h('div.pad.write-page');
    const size = Math.min(340, window.innerWidth - 40);
    const canvas = h('canvas.write-canvas', { width: size * 2, height: size * 2, style: { width: size + 'px', height: size + 'px' } });
    const guide = h('div.write-guide', { lang: 'ja', style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.78) + 'px', lineHeight: size + 'px' } }, ch);
    const scoreEl = h('div.write-score', '천천히 따라 써 보세요');
    let showGuide = true;
    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let drawing = false, last = null, strokes = 0;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return [(t.clientX - r.left) * 2, (t.clientY - r.top) * 2];
    };
    const color = () => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#222';
    const startDraw = (e) => { e.preventDefault(); drawing = true; last = pos(e); strokes++; };
    const moveDraw = (e) => {
      if (!drawing) return;
      e.preventDefault();
      const p = pos(e);
      ctx.strokeStyle = color();
      ctx.lineWidth = size * 0.075;
      ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      last = p;
    };
    const endDraw = () => { drawing = false; };
    canvas.addEventListener('pointerdown', startDraw);
    canvas.addEventListener('pointermove', moveDraw);
    window.addEventListener('pointerup', endDraw);
    canvas.style.touchAction = 'none';

    function grade() {
      // 그린 픽셀과 글자 모양 픽셀의 겹침으로 간단히 채점 (64×64 격자)
      const N = 64;
      const off = document.createElement('canvas');
      off.width = off.height = N;
      const o = off.getContext('2d');
      o.fillStyle = '#000';
      o.font = `${Math.round(N * 0.78)}px "Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif`;
      o.textAlign = 'center';
      o.textBaseline = 'middle';
      o.fillText(ch, N / 2, N / 2 + N * 0.03);
      const g = o.getImageData(0, 0, N, N).data;
      const d2 = document.createElement('canvas');
      d2.width = d2.height = N;
      const dc = d2.getContext('2d');
      dc.drawImage(canvas, 0, 0, N, N);
      const d = dc.getImageData(0, 0, N, N).data;
      const G = [], D = [];
      for (let i = 0; i < N * N; i++) { G.push(g[i * 4 + 3] > 60); D.push(d[i * 4 + 3] > 60); }
      const near = (arr, i) => {
        const x = i % N, y = (i / N) | 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < N && yy < N && arr[yy * N + xx]) return true;
        }
        return false;
      };
      let dN = 0, dIn = 0, gN = 0, gCov = 0;
      for (let i = 0; i < N * N; i++) {
        if (D[i]) { dN++; if (near(G, i)) dIn++; }
        if (G[i]) { gN++; if (near(D, i)) gCov++; }
      }
      if (!dN) { scoreEl.textContent = '먼저 글자를 써 주세요'; return; }
      const prec = dIn / dN, rec = gCov / Math.max(1, gN);
      const score = Math.round((2 * prec * rec) / Math.max(0.001, prec + rec) * 100);
      scoreEl.innerHTML = `${score >= 80 ? '🌟 아주 좋아요' : score >= 60 ? '👍 좋아요' : '✏️ 다시 한번'} · 일치도 <b>${score}%</b> (획 ${strokes})`;
      if (score >= 70) { App.sfx.good(); App.game.addXp(1); if (info) App.srs.touch(info.id, true); } else App.sfx.tap();
    }
    const clear = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); strokes = 0; scoreEl.textContent = '천천히 따라 써 보세요'; };
    const goTo = (d) => App.go('write/' + encodeURIComponent(seq[(idx + d + seq.length) % seq.length]), true);

    el.append(
      h('div.write-head',
        h('div.wh-char', { lang: 'ja' }, ch),
        h('div.wh-info', info ? (info.t === 'a' ? `${info.ko} · ${info.ro}${info.origin ? ' · 유래 ' + info.origin : ''}` : `${info.ko} · 음 ${info.on} · 훈 ${info.kun}`) : ''),
        App.views.speakBtn(info && info.t === 'k' ? App.jp.kana(info.words[0].w) : ch)),
      info && info.tip ? h('p.small.center.muted', '💡 ' + info.tip) : null,
      h('div.write-box', { style: { width: size + 'px', height: size + 'px' } }, h('div.write-cross'), guide, canvas),
      scoreEl,
      h('div.row.gap.center-row',
        h('button.btn.ghost', { type: 'button', onclick: () => goTo(-1) }, '‹ 이전'),
        h('button.btn.ghost', { type: 'button', onclick: clear }, '지우기'),
        h('button.btn.ghost', { type: 'button', onclick: () => { showGuide = !showGuide; guide.style.opacity = showGuide ? '' : '0'; } }, '가이드'),
        h('button.btn.primary', { type: 'button', onclick: grade }, '채점'),
        h('button.btn.ghost', { type: 'button', onclick: () => goTo(1) }, '다음 ›')),
      h('p.small.muted.center', '획순: 일반적으로 위→아래, 왼쪽→오른쪽 순서로 써요. 가이드를 끄고 기억으로 써 보면 더 효과적이에요!'));
    return { el, title: '쓰기 연습', back: true, tab: 'more', study: true, onLeave: () => window.removeEventListener('pointerup', endDraw) };
  };
})();
