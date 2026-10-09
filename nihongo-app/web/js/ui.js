/* UI 공통 컴포넌트: 토스트, 시트, 확인창, 축하 효과, 상단바, 하단 탭 */
'use strict';

App.ui = (function () {
  const { h } = App;
  let toastTimer = null;
  const overlays = [];

  function toast(msg, ms = 2200) {
    const t = App.$('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // 하단 시트 / 모달
  function sheet(content, { title = '', modal = false, onClose = null, cls = '' } = {}) {
    const root = App.$('#overlay');
    const back = h('div.ov-back');
    const panel = h('div.' + (modal ? 'modal' : 'sheet') + (cls ? '.' + cls : ''));
    const close = () => {
      const i = overlays.indexOf(entry);
      if (i >= 0) overlays.splice(i, 1);
      panel.classList.add('out');
      back.classList.add('out');
      setTimeout(() => { back.remove(); panel.remove(); }, 200);
      if (onClose) onClose();
    };
    const entry = { close };
    if (title) panel.appendChild(h('div.sheet-head', h('div.sheet-title', title), h('button.icon-btn', { type: 'button', 'aria-label': '닫기', onclick: close }, '✕')));
    const body = h('div.sheet-body');
    if (typeof content === 'function') content(body, close);
    else body.appendChild(content);
    panel.appendChild(body);
    back.addEventListener('click', close);
    root.append(back, panel);
    overlays.push(entry);
    requestAnimationFrame(() => { back.classList.add('in'); panel.classList.add('in'); });
    return { close, body, panel };
  }

  function confirm(msg, { ok = '확인', cancel = '취소', danger = false, title = '' } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const s = sheet((body, close) => {
        body.append(
          h('div.confirm-msg', { html: msg }),
          h('div.row.gap',
            h('button.btn.ghost.grow', { type: 'button', onclick: () => { done = true; close(); resolve(false); } }, cancel),
            h('button.btn.grow' + (danger ? '.danger' : '.primary'), { type: 'button', onclick: () => { done = true; close(); resolve(true); } }, ok)),
        );
      }, { modal: true, title, onClose: () => { if (!done) resolve(false); } });
      return s;
    });
  }

  function closeTop() {
    const top = overlays[overlays.length - 1];
    if (top) { top.close(); return true; }
    return false;
  }

  function confetti() {
    const c = h('div.confetti');
    const colors = ['#ff6b8b', '#ffc93c', '#4cc38a', '#4f7cff', '#b06bff', '#ff9f43'];
    for (let i = 0; i < 60; i++) {
      const p = h('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = Math.random() * 0.6 + 's';
      p.style.animationDuration = 1.6 + Math.random() * 1.4 + 's';
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      c.appendChild(p);
    }
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3500);
  }

  function celebrate(title, msg) {
    confetti();
    App.sfx.chime();
    sheet((body, close) => {
      body.append(
        h('div.celebrate', h('div.cel-title', title), h('div.cel-msg', msg)),
        h('button.btn.primary.block', { type: 'button', onclick: close }, '좋아요!'),
      );
    }, { modal: true });
  }

  /* 상단바 */
  function topStats() {
    const S = App.store.state;
    const hearts = App.game.hearts();
    return h('div.top-stats',
      h('button.chip.streak' + (App.game.streakAlive() ? '.on' : ''), { type: 'button', onclick: () => App.go('stats') }, `🔥 ${S.streak.count}`),
      h('button.chip.gem', { type: 'button', onclick: () => App.go('shop') }, `💎 ${S.gems}`),
      S.settings.hearts ? h('button.chip.heart', { type: 'button', onclick: () => heartsSheet() }, `❤️ ${hearts}`) : null,
    );
  }

  function refreshTop() {
    const box = App.$('#top .top-stats');
    if (box) box.replaceWith(topStats());
    const badge = App.$('#nav .badge');
    const due = App.srs.dueIds().length;
    if (badge) { badge.textContent = due > 99 ? '99+' : String(due); badge.style.display = due ? '' : 'none'; }
  }

  function heartsSheet() {
    const S = App.store.state;
    sheet((body, close) => {
      const hrt = App.game.hearts();
      const next = App.game.nextHeartIn();
      body.append(
        h('div.hearts-big', '❤️'.repeat(hrt) + '🤍'.repeat(App.game.HEART_MAX - hrt)),
        h('p.center.muted', hrt >= App.game.HEART_MAX ? '하트가 가득 찼어요!' : `다음 하트까지 ${Math.ceil(next / 60000)}분`),
        h('p.center.small', '챌린지 레슨에서 틀리면 하트가 1개 줄어요. 복습을 하면 하트를 회복할 수 있어요.'),
        h('div.col.gap',
          h('button.btn.primary.block', { type: 'button', disabled: hrt >= App.game.HEART_MAX || S.gems < 350, onclick: () => { if (App.game.spendGems(350)) { App.game.gainHeart(5); toast('하트를 모두 회복했어요!'); refreshTop(); close(); } } }, '💎 350 — 하트 모두 회복'),
          h('button.btn.ghost.block', { type: 'button', onclick: () => { close(); App.go('lesson/heal/x'); } }, '🩺 복습해서 하트 얻기'),
        ),
      );
    }, { title: '하트' });
  }

  const TABS = [
    ['home', '🏠', '홈'],
    ['course', '📘', '코스'],
    ['path', '🎮', '챌린지'],
    ['review', '🔁', '복습'],
    ['more', '☰', '더보기'],
  ];
  function nav(active) {
    const el = App.$('#nav');
    el.innerHTML = '';
    for (const [id, icon, label] of TABS) {
      const b = h('button.tab' + (active === id ? '.on' : ''), { type: 'button', onclick: () => App.go(id) },
        h('span.ti', icon), h('span.tl', label));
      if (id === 'review') {
        const due = App.srs.dueIds().length;
        const badge = h('span.badge', due > 99 ? '99+' : String(due));
        if (!due) badge.style.display = 'none';
        b.appendChild(badge);
      }
      el.appendChild(b);
    }
  }

  function header(title, { back = false, stats = true, right = null } = {}) {
    const top = App.$('#top');
    top.innerHTML = '';
    top.append(
      back ? h('button.icon-btn.back', { type: 'button', 'aria-label': '뒤로', onclick: () => App.back() }, '‹') : h('div.logo', h('span.logo-mark', { lang: 'ja' }, '日'), ''),
      h('div.top-title', title),
      right || (stats ? topStats() : h('div')),
    );
  }

  // 진행 링 (SVG)
  function ring(pct, size = 64, stroke = 7, label = '') {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(1, pct));
    const wrap = h('div.ring', { style: { width: size + 'px', height: size + 'px' } });
    wrap.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg><span class="ring-label">${label}</span>`;
    return wrap;
  }

  function bar(pct, cls = '') {
    return h('div.bar' + (cls ? '.' + cls : ''), h('i', { style: { width: Math.round(Math.max(0, Math.min(1, pct)) * 100) + '%' } }));
  }

  function empty(icon, msg, action) {
    return h('div.empty', h('div.empty-icon', icon), h('p', msg), action || null);
  }

  return { toast, sheet, confirm, closeTop, celebrate, confetti, refreshTop, nav, header, ring, bar, empty, heartsSheet, overlays };
})();
