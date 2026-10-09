/* 라우터, 부팅, 학습 시간 측정, 뒤로가기 처리 */
'use strict';

App.screens = App.screens || {};

(function () {
  const { h } = App;
  let current = null;
  let lastInteract = Date.now();

  // 자체 내비게이션 스택 (안드로이드 뒤로가기와 일치시키기 위함)
  const stack = [];
  const TAB_ROOTS = ['home', 'course', 'path', 'review', 'more'];

  App.go = function go(path, replace = false) {
    const target = '#/' + path.replace(/^#?\/?/, '');
    const name = target.slice(2).split(/[/?]/)[0];
    if (TAB_ROOTS.includes(name) && target.slice(2) === name) {
      stack.length = 0;
      stack.push('#/home');
      if (name !== 'home') stack.push(target);
    } else if (replace && stack.length) stack[stack.length - 1] = target;
    else stack.push(target);
    if (location.hash === target) { render(); return; }
    location.replace(target);
  };

  App.back = function back() {
    if (App.ui.closeTop()) return true;
    if (current && current.onBack) { current.onBack(); return true; }
    if (stack.length > 1) {
      stack.pop();
      location.replace(stack[stack.length - 1]);
      return true;
    }
    if (parse().name !== 'home') { App.go('home', true); return true; }
    return false;
  };
  // onBack 가로채기를 해제하고 뒤로 (레슨 종료 확인 후 사용)
  App.leave = function () {
    if (current) current.onBack = null;
    App.back();
  };
  // 안드로이드 뒤로가기 버튼 → "true"면 앱이 처리함
  App.handleBack = function handleBack() { return App.back() ? 'true' : 'false'; };

  function parse() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [p, qs] = raw.split('?');
    const parts = p.split('/').filter(Boolean).map(decodeURIComponent);
    const query = Object.fromEntries(new URLSearchParams(qs || ''));
    return { name: parts[0] || 'home', args: parts.slice(1), query };
  }
  App.route = parse;

  function render() {
    const r = parse();
    const S = App.store.state;
    if (!S.onboarded && r.name !== 'onboard') { App.go('onboard', true); return; }
    const fn = App.screens[r.name] || App.screens.home;
    if (current && current.onLeave) try { current.onLeave(); } catch (e) { console.error(e); }
    App.tts.stop();
    const view = App.$('#view');
    view.innerHTML = '';
    let scr;
    try {
      scr = fn(r.args, r.query) || {};
    } catch (e) {
      console.error(e);
      scr = { el: h('div.pad', h('h2', '앗, 오류가 발생했어요'), h('pre.small', String(e && e.stack || e))), title: '오류' };
    }
    current = scr;
    document.body.classList.toggle('full', !!scr.full);
    document.body.dataset.screen = r.name;
    if (!scr.full) {
      App.ui.header(scr.title || '일본어 마스터', { back: !!scr.back, stats: scr.stats !== false, right: scr.right });
      App.ui.nav(scr.tab || r.name);
    }
    if (scr.el) view.appendChild(scr.el);
    view.scrollTop = 0;
    window.scrollTo(0, 0);
    if (scr.onMount) setTimeout(() => scr.onMount(), 0);
  }
  App.rerender = render;

  window.addEventListener('hashchange', () => {
    if (stack[stack.length - 1] !== location.hash) {
      if (stack[stack.length - 2] === location.hash) stack.pop();
      else stack.push(location.hash);
    }
    render();
  });

  /* 테마 */
  App.applyTheme = function () {
    const t = App.store.state.settings.theme;
    const dark = t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.body.classList.toggle('no-furi', !App.store.state.settings.furigana);
    App.native.call('setDarkStatusBar', dark);
  };

  /* 학습 시간 측정: 학습 화면에서, 최근 90초 내 조작이 있을 때만 누적 */
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { lastInteract = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (document.hidden || !current) return;
    const focusing = App.focus && App.focus.running && !App.focus.paused && App.focus.mode === 'focus';
    if (!focusing && current.study && Date.now() - lastInteract < 90000) App.game.addStudyTime(10);
  }, 10000);

  /* 부팅 */
  App.boot = function () {
    App.store.load();
    App.tts.init();
    App.applyTheme();
    App.game.checkStreak();
    App.game.syncLeague();
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', App.applyTheme);
    if (!location.hash || location.hash === '#/') location.replace('#/home');
    stack.push('#/home');
    if (location.hash !== '#/home') stack.push(location.hash);
    render();
    setTimeout(() => {
      if (App.game._frozeMsg) { App.ui.toast(App.game._frozeMsg, 3500); App.game._frozeMsg = null; }
      else if (App.game._lostMsg) { App.ui.toast(App.game._lostMsg, 3500); App.game._lostMsg = null; }
    }, 600);
    document.documentElement.classList.add('ready');
  };

  // 네이티브가 앱 복귀를 알릴 때
  App.onResume = function () {
    App.game.checkStreak();
    App.ui.refreshTop();
  };
})();

document.addEventListener('DOMContentLoaded', () => App.boot());
