/* 간격 반복(SRS) + 게임화(XP·스트릭·하트·젬·리그·업적) */
'use strict';

/* ───────── SRS (SM-2 변형) ───────── */
App.srs = {
  DAY: 86400000,
  get S() { return App.store.state.srs; },
  has(id) { return !!App.srs.S[id]; },
  add(id, dueInMs = 0) {
    if (!App.C.items[id]) return;
    if (App.srs.S[id]) return App.srs.S[id];
    App.srs.S[id] = { due: Date.now() + dueInMs, ivl: 0, ef: 2.5, reps: 0, lapses: 0, last: 0, added: Date.now() };
    App.store.save();
    return App.srs.S[id];
  },
  addMany(ids, dueInMs = 12 * 3600000) { ids.forEach((id) => App.srs.add(id, dueInMs)); },
  // q: 0=다시, 1=어려움, 2=좋음, 3=쉬움 — 순수 함수(미리보기에도 사용)
  calc(card, q, now = Date.now()) {
    const c = Object.assign({ due: now, ivl: 0, ef: 2.5, reps: 0, lapses: 0, last: 0 }, card);
    if (q === 0) {
      c.lapses++;
      c.reps = 0;
      c.ivl = 0;
      c.ef = Math.max(1.3, c.ef - 0.2);
      c.due = now + 10 * 60000;
    } else {
      if (c.reps === 0) c.ivl = q === 1 ? 1 : q === 2 ? 1 : 4;
      else if (c.reps === 1) c.ivl = q === 1 ? 2 : q === 2 ? 3 : 6;
      else c.ivl = Math.max(c.ivl + 1, Math.round(c.ivl * (q === 1 ? 1.2 : q === 2 ? c.ef : c.ef * 1.3)));
      c.ef = App.util.clamp(c.ef + (q === 1 ? -0.15 : q === 3 ? 0.15 : 0), 1.3, 3.0);
      c.ivl = Math.min(c.ivl, 365);
      c.reps++;
      const d = new Date(now);
      d.setHours(4, 0, 0, 0); // 새벽 4시 기준으로 날짜 경계
      c.due = d.getTime() + c.ivl * App.srs.DAY;
    }
    c.last = now;
    return c;
  },
  grade(id, q) {
    const c = App.srs.S[id] || App.srs.add(id);
    if (!c) return;
    App.srs.S[id] = App.srs.calc(c, q);
    App.store.save();
  },
  previewLabel(id, q) {
    const c = App.srs.calc(App.srs.S[id] || {}, q);
    if (q === 0) return '10분';
    return c.ivl >= 30 ? `${Math.round(c.ivl / 30)}개월` : `${c.ivl}일`;
  },
  // 연습 문제 결과 반영 (자동 채점)
  touch(id, ok) {
    if (!id || !App.C.items[id]) return;
    const c = App.srs.S[id];
    if (!c) {
      App.srs.add(id, ok ? 20 * 3600000 : 5 * 60000);
      if (!ok) App.srs.markWrong(id);
      return;
    }
    if (!ok) {
      App.srs.markWrong(id);
      c.due = Math.min(c.due, Date.now() + 5 * 60000);
      c.ef = Math.max(1.3, c.ef - 0.1);
    } else if (c.due <= Date.now()) {
      App.srs.grade(id, 2);
    }
    App.store.save();
  },
  markWrong(id) {
    const w = App.store.state.wrong;
    w[id] = { n: ((w[id] && w[id].n) || 0) + 1, ts: Date.now() };
  },
  clearWrong(id) { delete App.store.state.wrong[id]; App.store.save(); },
  dueIds(limit = 9999, filter) {
    const now = Date.now();
    return Object.entries(App.srs.S)
      .filter(([id, c]) => c.due <= now && App.C.items[id] && (!filter || filter(App.C.items[id])))
      .sort((a, b) => a[1].due - b[1].due)
      .slice(0, limit)
      .map(([id]) => id);
  },
  stats() {
    const now = Date.now();
    const r = { total: 0, due: 0, learned: 0, mature: 0, v: 0, k: 0, g: 0, s: 0, a: 0 };
    for (const [id, c] of Object.entries(App.srs.S)) {
      const it = App.C.items[id];
      if (!it) continue;
      r.total++;
      r[it.t] = (r[it.t] || 0) + 1;
      if (c.due <= now) r.due++;
      if (c.reps >= 1) r.learned++;
      if (c.ivl >= 21) r.mature++;
    }
    return r;
  },
  // 오늘 이후 7일 예정
  forecast(days = 7) {
    const out = Array(days).fill(0);
    const base = new Date(); base.setHours(0, 0, 0, 0);
    for (const c of Object.values(App.srs.S)) {
      const d = Math.floor((c.due - base.getTime()) / App.srs.DAY);
      if (d < days) out[Math.max(0, d)]++;
    }
    return out;
  },
};

/* ───────── 게임화 ───────── */
App.game = {
  HEART_MAX: 5,
  HEART_MS: 30 * 60000,
  TIERS: [
    ['브론즈', '#c98a4b', '🥉'], ['실버', '#a8b4c0', '🥈'], ['골드', '#f2c230', '🥇'], ['사파이어', '#3d7fe0', '💠'],
    ['루비', '#e0384f', '♦️'], ['에메랄드', '#2fbf71', '💚'], ['자수정', '#9b59d0', '🔮'], ['진주', '#e8d9c5', '🦪'],
    ['흑요석', '#3b3b4f', '🖤'], ['다이아몬드', '#5fd4f4', '💎'],
  ],
  get S() { return App.store.state; },
  today() {
    const k = App.util.dayKey();
    const days = App.game.S.days;
    if (!days[k]) days[k] = { xp: 0, sec: 0, lessons: 0, reviews: 0, ok: 0, n: 0, goal: false };
    return days[k];
  },
  boostActive() { return App.game.S.boostUntil > Date.now(); },
  addXp(n, why = '') {
    if (!n) return 0;
    const S = App.game.S;
    if (App.game.boostActive()) n *= 2;
    const d = App.game.today();
    d.xp += n;
    S.xp += n;
    App.game.syncLeague();
    S.league.xp += n;
    App.game.bumpStreak();
    if (!d.goal && d.xp >= S.profile.goalXp) {
      d.goal = true;
      const bonus = 10 + Math.min(20, S.streak.count);
      S.gems += bonus;
      S.counters.goalDays = (S.counters.goalDays || 0) + 1;
      setTimeout(() => App.ui && App.ui.celebrate('🎯 오늘의 목표 달성!', `보상으로 💎 ${bonus}개를 받았어요`), 400);
    }
    App.store.save();
    App.game.checkAch();
    if (App.ui && App.ui.refreshTop) App.ui.refreshTop();
    return n;
  },
  recordAnswer(ok) {
    const d = App.game.today();
    d.n++;
    if (ok) d.ok++;
  },
  addStudyTime(sec, focus = false) {
    const d = App.game.today();
    d.sec += sec;
    if (focus) App.game.S.counters.focusSec += sec;
    App.store.save();
  },
  /* 스트릭 */
  checkStreak() {
    const s = App.game.S.streak;
    if (!s.last) return;
    const today = App.util.dayKey();
    const gap = App.util.daysBetween(s.last, today);
    if (gap <= 1) return;
    const missed = gap - 1;
    if (s.freezes >= missed) {
      s.freezes -= missed;
      s.last = App.util.addDays(today, -1);
      App.game._frozeMsg = `🧊 스트릭 프리즈 ${missed}개를 사용해 연속 기록을 지켰어요!`;
    } else {
      if (s.count > 0) App.game._lostMsg = `연속 학습 ${s.count}일 기록이 끊어졌어요. 오늘부터 다시 시작해요! 💪`;
      s.count = 0;
    }
    App.store.save();
  },
  bumpStreak() {
    const s = App.game.S.streak;
    const today = App.util.dayKey();
    if (s.last === today) return;
    if (s.last && App.util.daysBetween(s.last, today) === 1) s.count++;
    else s.count = 1;
    s.last = today;
    s.best = Math.max(s.best, s.count);
    if (s.count > 1 && s.count % 7 === 0) { App.game.S.gems += 30; }
  },
  streakAlive() { return App.game.S.streak.last === App.util.dayKey(); },
  /* 하트 */
  hearts() {
    const S = App.game.S;
    if (!S.settings.hearts) return Infinity;
    if (S.hearts < App.game.HEART_MAX) {
      const gained = Math.floor((Date.now() - S.heartsTs) / App.game.HEART_MS);
      if (gained > 0) {
        S.hearts = Math.min(App.game.HEART_MAX, S.hearts + gained);
        S.heartsTs = S.hearts >= App.game.HEART_MAX ? Date.now() : S.heartsTs + gained * App.game.HEART_MS;
        App.store.save();
      }
    } else S.heartsTs = Date.now();
    return S.hearts;
  },
  nextHeartIn() {
    const S = App.game.S;
    if (S.hearts >= App.game.HEART_MAX) return 0;
    return Math.max(0, App.game.HEART_MS - (Date.now() - S.heartsTs));
  },
  loseHeart() {
    const S = App.game.S;
    if (!S.settings.hearts) return Infinity;
    App.game.hearts();
    if (S.hearts >= App.game.HEART_MAX) S.heartsTs = Date.now();
    S.hearts = Math.max(0, S.hearts - 1);
    App.store.save();
    return S.hearts;
  },
  gainHeart(n = 1) {
    const S = App.game.S;
    S.hearts = Math.min(App.game.HEART_MAX, S.hearts + n);
    App.store.save();
  },
  spendGems(n) {
    const S = App.game.S;
    if (S.gems < n) return false;
    S.gems -= n;
    App.store.save();
    return true;
  },
  /* 리그 (주간, 가상 경쟁자) */
  BOTS: [
    ['さくら', '🌸'], ['민준', '🐯'], ['ユウキ', '⚡'], ['지우', '🐰'], ['はると', '🍙'], ['서연', '🌙'], ['りん', '🎐'],
    ['도윤', '🐻'], ['ひなた', '🌻'], ['하은', '🍓'], ['そうた', '🚀'], ['예준', '🎧'], ['あおい', '🐳'], ['수아', '🦋'],
    ['けんた', '🍜'], ['시우', '🐧'], ['みお', '🍡'], ['지호', '🎮'], ['れん', '🗻'], ['유나', '🌷'],
  ],
  syncLeague() {
    const L = App.game.S.league;
    const wk = App.util.weekKey();
    if (L.week === wk) return;
    if (L.week) {
      const res = App.game.leagueTable(L.week, L.xp, 1);
      const rank = res.findIndex((m) => m.me) + 1;
      let change = 0;
      if (rank <= 3 && L.tier < App.game.TIERS.length - 1) { L.tier++; change = 1; }
      else if (rank >= res.length - 2 && L.tier > 0 && L.xp < 50) { L.tier--; change = -1; }
      L.last = { week: L.week, rank, xp: L.xp, change };
      if (rank <= 3) App.game.S.gems += [0, 50, 30, 20][rank];
    }
    L.week = wk;
    L.xp = 0;
    L.seed = Math.floor(Math.random() * 1e9);
    App.store.save();
  },
  leagueTable(week, myXp, frac) {
    const L = App.game.S.league;
    const rnd = App.util.rng(L.seed);
    const pool = App.game.BOTS.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const names = pool.slice(0, 14);
    // 주간 진행률 (월요일 0시 ~ 다음 월요일)
    if (frac == null) {
      const start = App.util.parseDay(week).getTime();
      frac = App.util.clamp((Date.now() - start) / (7 * 86400000), 0, 1);
    }
    const base = 25 + L.tier * 14;
    const members = names.map(([name, avatar]) => {
      const pace = base * (0.15 + rnd() * 1.7);
      const curve = Math.pow(frac, 0.85 + rnd() * 0.3);
      return { name, avatar, xp: Math.round(pace * 7 * curve), me: false };
    });
    const S = App.game.S;
    members.push({ name: S.profile.name || '나', avatar: S.profile.avatar || '🦊', xp: myXp, me: true });
    members.sort((a, b) => b.xp - a.xp || (a.me ? -1 : 1));
    return members;
  },
  league() {
    App.game.syncLeague();
    const L = App.game.S.league;
    const table = App.game.leagueTable(L.week, L.xp);
    const rank = table.findIndex((m) => m.me) + 1;
    const end = App.util.parseDay(L.week).getTime() + 7 * 86400000;
    return { table, rank, tier: L.tier, tierInfo: App.game.TIERS[L.tier], msLeft: end - Date.now(), last: L.last };
  },
  /* 업적 */
  ACH: [
    ['first', '🌱', '첫걸음', '첫 레슨을 완료했어요', (s) => s.counters.lessons >= 1, 10],
    ['l10', '📗', '꾸준한 학습자', '레슨 10개 완료', (s) => s.counters.lessons >= 10, 20],
    ['l50', '📚', '열공 모드', '레슨 50개 완료', (s) => s.counters.lessons >= 50, 50],
    ['l200', '🏛️', '배움의 탑', '레슨 200개 완료', (s) => s.counters.lessons >= 200, 150],
    ['s3', '🔥', '불씨', '3일 연속 학습', (s) => s.streak.best >= 3, 15],
    ['s7', '🔥', '일주일의 불꽃', '7일 연속 학습', (s) => s.streak.best >= 7, 40],
    ['s30', '🌋', '한 달의 열정', '30일 연속 학습', (s) => s.streak.best >= 30, 150],
    ['s100', '☀️', '백일의 태양', '100일 연속 학습', (s) => s.streak.best >= 100, 500],
    ['x100', '⭐', 'XP 100', '누적 100 XP', (s) => s.xp >= 100, 10],
    ['x1k', '🌟', 'XP 1,000', '누적 1,000 XP', (s) => s.xp >= 1000, 50],
    ['x5k', '💫', 'XP 5,000', '누적 5,000 XP', (s) => s.xp >= 5000, 120],
    ['x20k', '🌠', 'XP 20,000', '누적 20,000 XP', (s) => s.xp >= 20000, 400],
    ['w50', '🗂️', '단어 수집가', '단어 50개 학습', () => App.srs.stats().v >= 50, 20],
    ['w300', '📖', '어휘 부자', '단어 300개 학습', () => App.srs.stats().v >= 300, 60],
    ['w1000', '🧠', '걸어다니는 사전', '단어 1,000개 학습', () => App.srs.stats().v >= 1000, 200],
    ['k100', '漢', '한자 입문', '한자 100자 학습', () => App.srs.stats().k >= 100, 50],
    ['k400', '🏯', '한자 달인', '한자 400자 학습', () => App.srs.stats().k >= 400, 150],
    ['p5', '💯', '완벽주의자', '실수 없는 레슨 5회', (s) => s.counters.perfect >= 5, 25],
    ['p30', '🎯', '백발백중', '실수 없는 레슨 30회', (s) => s.counters.perfect >= 30, 100],
    ['r100', '🔁', '복습의 힘', '복습 카드 100장', (s) => s.counters.reviews >= 100, 30],
    ['r1000', '♾️', '망각 곡선 정복', '복습 카드 1,000장', (s) => s.counters.reviews >= 1000, 150],
    ['f1h', '🧘', '집중의 시작', '집중 모드 누적 1시간', (s) => s.counters.focusSec >= 3600, 30],
    ['f10h', '🏔️', '몰입의 경지', '집중 모드 누적 10시간', (s) => s.counters.focusSec >= 36000, 120],
    ['sp20', '🎤', '입을 열다', '말하기 연습 20회', (s) => s.counters.speak >= 20, 30],
    ['t10', '🏋️', '트레이닝 입문', '트레이닝 10회', (s) => (s.counters.drills || 0) >= 10, 20],
    ['t100', '🥋', '트레이닝 마스터', '트레이닝 100회', (s) => (s.counters.drills || 0) >= 100, 100],
    ['lis100', '🎧', '귀가 트이다', '일본어 문장 100개 듣기', (s) => (s.counters.listen || 0) >= 100, 40],
    ['lis1k', '📻', '일본어 라디오', '일본어 문장 1,000개 듣기', (s) => (s.counters.listen || 0) >= 1000, 150],
    ['plan7', '📋', '계획형 학습자', '오늘의 플랜 7일 완료', (s) => Object.keys(s.plan || {}).length >= 7, 60],
    ['place', '🧭', '실력 진단', '레벨 진단 완료', (s) => !!s.placement, 15],
    ['exam', '📝', '실전 감각', '모의고사 1회 응시', (s) => s.counters.exams >= 1, 20],
    ['pass', '🎓', '합격 예감', '모의고사 합격', (s) => s.exams.some((e) => e.pass), 100],
    ['kana', 'あ', '문자 정복', '문자 단원 전체 완료', () => App.game.levelDone('kana'), 50],
    ['n5', '5️⃣', 'N5 완주', 'N5 전체 단원 완료', () => App.game.levelDone('n5'), 100],
    ['n4', '4️⃣', 'N4 완주', 'N4 전체 단원 완료', () => App.game.levelDone('n4'), 150],
    ['n3', '3️⃣', 'N3 완주', 'N3 전체 단원 완료', () => App.game.levelDone('n3'), 200],
    ['n2', '2️⃣', 'N2 완주', 'N2 전체 단원 완료', () => App.game.levelDone('n2'), 300],
    ['n1', '👑', 'N1 완주', 'N1 전체 단원 완료 — 축하합니다!', () => App.game.levelDone('n1'), 500],
  ],
  unitDone(u) {
    const S = App.game.S;
    const c = S.course[u.id];
    if (c && c.done) return true;
    if (S.skipped[u.lv]) return true;
    const nodes = App.path ? App.path.nodesOf(u) : [];
    return nodes.length > 0 && nodes.every((n) => (S.path[n.id] || {}).n > 0);
  },
  levelDone(lvId) {
    const lv = App.C.levelById[lvId];
    return !!lv && lv.units.every((u) => App.game.unitDone(u));
  },
  checkAch() {
    const S = App.game.S;
    for (const [id, icon, title, desc, test, gems] of App.game.ACH) {
      if (S.ach[id]) continue;
      let ok = false;
      try { ok = test(S); } catch (e) { ok = false; }
      if (ok) {
        S.ach[id] = Date.now();
        S.gems += gems;
        App.store.save();
        if (App.ui) setTimeout(() => App.ui.toast(`${icon} 업적 달성: ${title} (+💎${gems})`, 3200), 900);
      }
    }
  },
};
