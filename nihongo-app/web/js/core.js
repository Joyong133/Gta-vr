/* 일본어 마스터 — 코어 유틸리티, 저장소, 네이티브 브릿지, 음성 */
'use strict';

const App = (window.App = window.App || {});

/* ───────── DOM 헬퍼 ───────── */
App.$ = (sel, root = document) => root.querySelector(sel);
App.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * h('div.card#id', {onclick, html, style, data:{}}, ...children)
 */
App.h = function h(spec, attrs, ...children) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    if (attrs != null) children.unshift(attrs);
    attrs = {};
  }
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
  const el = document.createElement(m[1] || 'div');
  if (m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k === 'data') for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = dv;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
};

// 화면 코드에서 조건부 자식(null/false)을 넘겨도 안전하도록 append를 보강
(function () {
  const native = Element.prototype.append;
  Element.prototype.append = function (...nodes) {
    return native.apply(this, nodes.flat(Infinity).filter((n) => n != null && n !== false));
  };
})();

/* ───────── 일반 유틸 ───────── */
App.util = {
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },
  sample(arr, n) { return App.util.shuffle(arr).slice(0, n); },
  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
  clamp(v, a, b) { return Math.max(a, Math.min(b, v)); },
  uniq(arr, key = (x) => x) {
    const seen = new Set();
    return arr.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
  },
  esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  dayKey(d = new Date()) {
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  },
  parseDay(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); },
  addDays(key, n) { const d = App.util.parseDay(key); d.setDate(d.getDate() + n); return App.util.dayKey(d); },
  daysBetween(a, b) { return Math.round((App.util.parseDay(b) - App.util.parseDay(a)) / 86400000); },
  weekKey(d = new Date()) {
    // 월요일 시작 주의 월요일 날짜
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const wd = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - wd);
    return App.util.dayKey(x);
  },
  fmtMin(sec) {
    const m = Math.round(sec / 60);
    if (m < 60) return `${m}분`;
    return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  },
  fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  },
  hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  },
  rng(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  },
  debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  },
  sleep(ms) { return new Promise((r) => setTimeout(r, ms)); },
};

/* ───────── 일본어 텍스트(후리가나 마크업) ───────── */
// 마크업: 漢字[かんじ] / 공백 = 어절 구분
const RUBY_RE = /([㐀-鿿豈-﫿々〆ヵヶ]+)\[([^\]]+)\]/g;
const JA_CH = /[　-ヿ㐀-鿿豈-﫿＀-￯々〆ヵヶー\]）（]/;

App.jp = {
  // 일본어 문자 사이의 공백(어절 구분)만 제거하고, 한국어·영어 주변 공백은 유지
  dropSpaces(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === ' ') {
        const p = s[i - 1] || '', n = s[i + 1] || '';
        if (JA_CH.test(p) && JA_CH.test(n)) continue;
      }
      out += c;
    }
    return out;
  },
  ruby(s) {
    if (s == null) return '';
    const esc = App.util.esc(App.jp.dropSpaces(String(s)));
    return esc.replace(RUBY_RE, '<ruby>$1<rt>$2</rt></ruby>');
  },
  plain(s) { return App.jp.dropSpaces(String(s || '').replace(RUBY_RE, '$1')); },
  kana(s) { return App.jp.dropSpaces(String(s || '').replace(RUBY_RE, '$2')); },
  chunks(s) { return String(s).trim().split(/\s+/).filter(Boolean); },
  // 비교용 정규화: 루비/공백/문장부호 제거
  norm(s) {
    return App.jp.plain(s).replace(/[\s。、，．,.!?！？「」『』（）()・…〜~ー\-]/g, '').toLowerCase();
  },
  normKo(s) { return String(s).replace(/[\s.,!?~…"'“”‘’()]/g, ''); },
  hasKanji(s) { return /[㐀-鿿々]/.test(s); },
  isKanaOnly(s) { return /^[぀-ヿー・\s]+$/.test(s); },
  // 히라가나 ↔ 가타카나
  toHira(s) { return String(s).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)); },
  // 문자열 유사도 (발음 인식 채점용, 0..1)
  similarity(a, b) {
    a = App.jp.toHira(a); b = App.jp.toHira(b);
    if (!a.length && !b.length) return 1;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return 1 - dp[a.length][b.length] / Math.max(a.length, b.length);
  },
};

/* ───────── 네이티브 브릿지 ───────── */
App.native = {
  get app() { return window.NativeApp || null; },
  get available() { return !!window.NativeApp; },
  call(method, ...args) {
    try {
      const n = window.NativeApp;
      if (n && typeof n[method] === 'function') return n[method](...args);
    } catch (e) { console.warn('native', method, e); }
    return undefined;
  },
  vibrate(ms = 30) {
    if (!App.store.state.settings.haptic) return;
    if (App.native.available) App.native.call('vibrate', ms);
    else if (navigator.vibrate) try { navigator.vibrate(ms); } catch (e) { /* ignore */ }
  },
  keepScreenOn(on) { App.native.call('keepScreenOn', !!on); },
};

/* ───────── 저장소 ───────── */
App.store = {
  KEY: 'nihongo-master-v1',
  state: null,
  defaults() {
    return {
      v: 1,
      created: Date.now(),
      onboarded: false,
      profile: { name: '학습자', goalXp: 30, target: 'n3', examDate: '', avatar: '🦊' },
      settings: {
        theme: 'auto', furigana: true, romaji: true, ttsRate: 0.9, autoplay: true,
        sound: true, haptic: true, hearts: true, speak: true, listen: true,
        reminder: '', focusMin: 25, breakMin: 5, reviewBatch: 20, noise: 'rain',
      },
      xp: 0, gems: 50, hearts: 5, heartsTs: Date.now(),
      boostUntil: 0,
      streak: { count: 0, last: '', best: 0, freezes: 1 },
      days: {},
      course: {},   // unitId → { seen:{tab:true}, test: best%, done:bool }
      viewed: {},   // grammarId → ts
      path: {},     // nodeId → { n: 완료 횟수, best: 정확도 }
      skipped: {},  // levelId → true (건너뛰기 테스트 통과)
      srs: {},      // itemId → { due, ivl, ef, reps, lapses, last }
      wrong: {},    // itemId → { n, ts }
      marks: {},    // 즐겨찾기 itemId → ts
      exams: [],    // { level, score, max, pass, date, parts }
      ach: {},      // 업적 id → ts
      league: { week: '', tier: 0, xp: 0, seed: Math.floor(Math.random() * 1e9), last: null },
      counters: { lessons: 0, perfect: 0, reviews: 0, focusSec: 0, speak: 0, exams: 0, chests: 0 },
      lastUnit: '', lastNode: '',
    };
  },
  merge(base, saved) {
    for (const k of Object.keys(saved || {})) {
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && saved[k] && typeof saved[k] === 'object' && !Array.isArray(saved[k])) {
        base[k] = App.store.merge(base[k], saved[k]);
      } else base[k] = saved[k];
    }
    return base;
  },
  load() {
    let raw = null;
    try { raw = localStorage.getItem(App.store.KEY); } catch (e) { /* storage blocked */ }
    if (!raw && App.native.available) raw = App.native.call('loadState') || null;
    let saved = null;
    try { saved = raw ? JSON.parse(raw) : null; } catch (e) { saved = null; }
    App.store.state = App.store.merge(App.store.defaults(), saved || {});
    return App.store.state;
  },
  _write() {
    const json = JSON.stringify(App.store.state);
    try { localStorage.setItem(App.store.KEY, json); } catch (e) { /* ignore */ }
    if (App.native.available) App.native.call('saveState', json);
  },
  save: null,
  flush() { App.store._write(); },
  reset() {
    App.store.state = App.store.defaults();
    App.store._write();
  },
  importJson(json) {
    const data = JSON.parse(json);
    if (!data || typeof data !== 'object' || !data.v) throw new Error('올바른 백업 데이터가 아닙니다');
    App.store.state = App.store.merge(App.store.defaults(), data);
    App.store._write();
  },
};
App.store.save = App.util.debounce(() => App.store._write(), 250);
window.addEventListener('pagehide', () => App.store.state && App.store.flush());
document.addEventListener('visibilitychange', () => { if (document.hidden && App.store.state) App.store.flush(); });

/* ───────── 음성 (TTS) ───────── */
App.tts = {
  _voice: null,
  _ready: false,
  init() {
    if (window.speechSynthesis && !App.native.available) {
      const pickVoice = () => {
        const vs = speechSynthesis.getVoices();
        App.tts._voice = vs.find((v) => /ja[-_]JP/i.test(v.lang)) || vs.find((v) => /^ja/i.test(v.lang)) || null;
      };
      pickVoice();
      speechSynthesis.onvoiceschanged = pickVoice;
    }
  },
  get supported() {
    return App.native.available ? true : !!window.speechSynthesis;
  },
  speak(text, opts = {}) {
    const t = App.jp.plain(text).replace(/[（(]\s*[)）]/g, '').trim();
    if (!t) return;
    const rate = opts.rate || App.store.state.settings.ttsRate || 0.9;
    if (App.native.available) {
      App.native.call('speak', t, rate, opts.lang || 'ja-JP');
      return;
    }
    if (!window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t);
      u.lang = opts.lang || 'ja-JP';
      if (App.tts._voice && u.lang.startsWith('ja')) u.voice = App.tts._voice;
      u.rate = rate;
      speechSynthesis.speak(u);
    } catch (e) { console.warn(e); }
  },
  stop() {
    if (App.native.available) App.native.call('stopSpeak');
    else if (window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  },
};

/* ───────── 음성 인식 (말하기) ───────── */
App.speech = {
  _pending: {},
  _seq: 0,
  get supported() {
    if (App.native.available) {
      if (App.speech._nat == null) App.speech._nat = !!App.native.call('speechAvailable');
      return App.speech._nat;
    }
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  },
  listen(lang = 'ja-JP') {
    return new Promise((resolve, reject) => {
      if (App.native.available) {
        const id = ++App.speech._seq;
        App.speech._pending[id] = { resolve, reject };
        App.native.call('startSpeech', id, lang);
        return;
      }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return reject(new Error('unsupported'));
      const r = new SR();
      r.lang = lang;
      r.maxAlternatives = 5;
      r.onresult = (e) => resolve(Array.from(e.results[0]).map((x) => x.transcript));
      r.onerror = (e) => reject(new Error(e.error || 'error'));
      r.start();
    });
  },
  // 네이티브에서 호출
  _onResult(id, json) {
    const p = App.speech._pending[id];
    if (!p) return;
    delete App.speech._pending[id];
    let list = [];
    try { list = JSON.parse(json) || []; } catch (e) { /* ignore */ }
    if (list.length) p.resolve(list);
    else p.reject(new Error('no-result'));
  },
};

/* ───────── 효과음 (WebAudio로 생성, 파일 불필요) ───────── */
App.sfx = {
  ctx: null,
  _ctx() {
    if (!App.sfx.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      App.sfx.ctx = new AC();
    }
    if (App.sfx.ctx.state === 'suspended') App.sfx.ctx.resume();
    return App.sfx.ctx;
  },
  tone(freqs, { dur = 0.12, type = 'sine', gap = 0.09, vol = 0.18 } = {}) {
    if (!App.store.state.settings.sound) return;
    const ctx = App.sfx._ctx();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.01;
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = f;
      const s = t0 + i * gap;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(vol, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
      o.connect(g).connect(ctx.destination);
      o.start(s);
      o.stop(s + dur + 0.02);
    });
  },
  good() { App.sfx.tone([660, 990], { dur: 0.16, type: 'triangle' }); App.native.vibrate(20); },
  bad() { App.sfx.tone([220, 165], { dur: 0.2, type: 'sawtooth', vol: 0.08, gap: 0.12 }); App.native.vibrate(120); },
  tap() { App.sfx.tone([520], { dur: 0.05, type: 'sine', vol: 0.06 }); },
  done() { App.sfx.tone([523, 659, 784, 1047], { dur: 0.22, type: 'triangle', gap: 0.11 }); App.native.vibrate(60); },
  chime() { App.sfx.tone([880, 1175, 1568], { dur: 0.5, type: 'sine', gap: 0.18, vol: 0.12 }); },
};

/* ───────── 집중용 배경 소리 (노이즈 생성) ───────── */
App.noise = {
  node: null, gain: null, kind: '',
  start(kind = 'rain') {
    App.noise.stop();
    const ctx = App.sfx._ctx();
    if (!ctx) return;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else if (kind === 'pink' || kind === 'rain') {
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
        if (kind === 'rain' && Math.random() < 0.0009) d[i] += (Math.random() - 0.5) * 0.9; // 빗방울
      } else d[i] = w * 0.25;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = kind === 'rain' ? 2600 : kind === 'brown' ? 900 : 8000;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start();
    g.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 1.5);
    App.noise.node = src; App.noise.gain = g; App.noise.kind = kind;
  },
  stop() {
    if (App.noise.node) {
      try {
        const ctx = App.sfx.ctx;
        App.noise.gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
        const n = App.noise.node;
        setTimeout(() => { try { n.stop(); } catch (e) { /* ignore */ } }, 450);
      } catch (e) { /* ignore */ }
    }
    App.noise.node = null; App.noise.kind = '';
  },
};
