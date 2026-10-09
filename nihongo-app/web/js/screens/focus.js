/* 집중 모드: 뽀모도로 타이머(화면 이동해도 유지) + 배경 소리 + 화면 꺼짐 방지 */
'use strict';

(function () {
  const { h, util } = App;
  const S = () => App.store.state;

  const F = (App.focus = {
    running: false, paused: false, mode: 'focus', endAt: 0, left: 0, total: 0, rounds: 0, lastTick: 0,
    start(mode = 'focus') {
      const st = S().settings;
      const min = mode === 'focus' ? st.focusMin : st.breakMin;
      F.mode = mode;
      F.total = min * 60;
      F.left = F.total;
      F.endAt = Date.now() + F.total * 1000;
      F.running = true;
      F.paused = false;
      F.lastTick = Date.now();
      if (mode === 'focus' && st.noise && st.noise !== 'none') App.noise.start(st.noise);
      if (mode === 'break') App.noise.stop();
      App.native.keepScreenOn(true);
      pill();
    },
    pause() {
      if (!F.running) return;
      F.paused = !F.paused;
      if (F.paused) { F.left = Math.max(0, (F.endAt - Date.now()) / 1000); App.noise.stop(); }
      else {
        F.endAt = Date.now() + F.left * 1000;
        F.lastTick = Date.now();
        const n = S().settings.noise;
        if (F.mode === 'focus' && n && n !== 'none') App.noise.start(n);
      }
      pill();
    },
    stop() {
      F.running = false;
      F.paused = false;
      App.noise.stop();
      App.native.keepScreenOn(false);
      pill();
    },
    remaining() { return F.paused ? F.left : Math.max(0, (F.endAt - Date.now()) / 1000); },
  });

  function complete() {
    const wasFocus = F.mode === 'focus';
    App.sfx.chime();
    App.native.vibrate(400);
    if (wasFocus) {
      F.rounds++;
      const d = App.game.today();
      d.pomo = (d.pomo || 0) + 1;
      App.game.addXp(5, 'focus');
      App.ui.toast(`🍅 집중 ${S().settings.focusMin}분 완료! +5 XP · 잠깐 쉬어요`, 3500);
      F.start('break');
    } else {
      App.ui.toast('☕ 휴식 끝! 다시 집중해 볼까요?', 3000);
      F.stop();
    }
    if (location.hash.startsWith('#/focus')) App.rerender();
  }

  setInterval(() => {
    if (!F.running || F.paused) return;
    const now = Date.now();
    const dt = Math.min(5, (now - F.lastTick) / 1000);
    F.lastTick = now;
    if (F.mode === 'focus') App.game.addStudyTime(dt, true);
    if (F.remaining() <= 0) complete();
    pill();
    const ring = App.$('#focus-ring');
    if (ring) updateRing(ring);
  }, 1000);

  function pill() {
    let p = App.$('#focus-pill');
    if (!F.running) { if (p) p.remove(); return; }
    if (!p) {
      p = h('button#focus-pill', { type: 'button', onclick: () => App.go('focus') });
      document.body.appendChild(p);
    }
    p.className = F.mode + (F.paused ? ' paused' : '');
    p.textContent = `${F.mode === 'focus' ? '🧘' : '☕'} ${util.fmtClock(F.remaining())}${F.paused ? ' ⏸' : ''}`;
    p.style.display = location.hash.startsWith('#/focus') ? 'none' : '';
  }
  window.addEventListener('hashchange', pill);

  function updateRing(ring) {
    const rem = F.running ? F.remaining() : S().settings.focusMin * 60;
    const pct = F.running ? 1 - rem / F.total : 0;
    ring.replaceWith(Object.assign(App.ui.ring(1 - pct, 250, 14, `<b class="big-clock">${util.fmtClock(rem)}</b><small>${F.running ? (F.mode === 'focus' ? '집중 중' : '휴식 중') : '준비'}</small>`), { id: 'focus-ring' }));
  }

  App.screens.focus = function () {
    const st = S();
    const d = App.game.today();
    const el = h('div.pad.focus-page' + (F.running && F.mode === 'break' ? '.break' : ''));
    const ring = App.ui.ring(1, 250, 14, '');
    ring.id = 'focus-ring';
    el.append(
      h('p.center.muted', '스마트폰 알림을 끄고, 한 가지 공부에만 몰입해 보세요. 타이머는 다른 화면으로 이동해도 계속돼요.'),
      h('div.focus-ring-wrap', ring),
      h('div.row.gap.center-row',
        !F.running ? h('button.btn.primary.big', { type: 'button', onclick: () => { F.start('focus'); App.rerender(); } }, '▶ 집중 시작') : null,
        F.running ? h('button.btn.ghost.big', { type: 'button', onclick: () => { F.pause(); App.rerender(); } }, F.paused ? '▶ 계속' : '⏸ 일시정지') : null,
        F.running ? h('button.btn.ghost.big', { type: 'button', onclick: () => { F.stop(); App.rerender(); } }, '■ 종료') : null),
      h('div.focus-today', `오늘 완료한 집중 🍅 ${d.pomo || 0}회 · 오늘 학습 ${util.fmtMin(d.sec)}`),
    );
    const durRow = h('div.seg');
    for (const m of [15, 25, 45, 60]) {
      durRow.appendChild(h('button.seg-btn' + (st.settings.focusMin === m ? '.on' : ''), { type: 'button', disabled: F.running, onclick: () => { st.settings.focusMin = m; st.settings.breakMin = m >= 45 ? 10 : 5; App.store.save(); App.rerender(); } }, `${m}분`));
    }
    const noiseRow = h('div.seg');
    for (const [k, l] of [['none', '없음'], ['rain', '🌧 빗소리'], ['pink', '🌊 파도'], ['brown', '🔥 모닥불'], ['white', '📻 백색']]) {
      noiseRow.appendChild(h('button.seg-btn' + (st.settings.noise === k ? '.on' : ''), { type: 'button', onclick: () => {
        st.settings.noise = k; App.store.save();
        if (F.running && F.mode === 'focus' && !F.paused) { if (k === 'none') App.noise.stop(); else App.noise.start(k); }
        App.rerender();
      } }, l));
    }
    el.append(h('div.section-title', '집중 시간'), durRow, h('div.section-title', '배경 소리'), noiseRow);
    el.append(h('div.section-title', '집중하면서 할 일'),
      h('div.tool-grid',
        h('button.tool', { type: 'button', onclick: () => App.go('cards/srs/all') }, h('span.tool-i', '🃏'), h('span.tool-t', 'SRS 복습')),
        h('button.tool', { type: 'button', onclick: () => App.go('course') }, h('span.tool-i', '📘'), h('span.tool-t', '체계 코스')),
        h('button.tool', { type: 'button', onclick: () => App.go('path') }, h('span.tool-i', '🎮'), h('span.tool-t', '챌린지')),
        h('button.tool', { type: 'button', onclick: () => App.go('exam') }, h('span.tool-i', '📝'), h('span.tool-t', '모의고사')),
        h('button.tool', { type: 'button', onclick: () => App.go('write/あ') }, h('span.tool-i', '✍️'), h('span.tool-t', '쓰기 연습')),
        h('button.tool', { type: 'button', onclick: () => App.go('dict') }, h('span.tool-i', '🔎'), h('span.tool-t', '사전'))));
    el.append(h('div.tip-box', h('b', '💡 집중력 높이는 공부법'),
      h('ul',
        h('li', '25분 집중 + 5분 휴식(뽀모도로)을 4번 반복한 뒤 길게 쉬세요.'),
        h('li', '휴식 시간엔 화면 대신 스트레칭·물 마시기! 뇌가 기억을 정리해요.'),
        h('li', '공부한 내용을 소리 내어 읽으면(音読) 기억에 2배 오래 남아요.'),
        h('li', '틀린 문제는 오답 노트에 자동 저장돼요. 집중 세션 마지막 5분은 오답 복습으로!'))));
    return { el, title: '집중 모드', back: true, tab: 'more', study: false, onMount: () => updateRing(App.$('#focus-ring')) };
  };
})();
