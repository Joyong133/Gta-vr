/* 숫자·시간·날짜·조수사 트레이너 (읽기 엔진 + 화면 + 연습) */
'use strict';

App.num = (function () {
  const { util } = App;
  const D1 = ['', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
  const KD = '〇一二三四五六七八九';

  function under(n, bigUnit = false) {
    let s = '';
    const th = Math.floor(n / 1000), hu = Math.floor(n / 100) % 10, te = Math.floor(n / 10) % 10, on = n % 10;
    if (th) s += th === 1 ? (bigUnit ? 'いっせん' : 'せん') : th === 3 ? 'さんぜん' : th === 8 ? 'はっせん' : D1[th] + 'せん';
    if (hu) s += hu === 1 ? 'ひゃく' : hu === 3 ? 'さんびゃく' : hu === 6 ? 'ろっぴゃく' : hu === 8 ? 'はっぴゃく' : D1[hu] + 'ひゃく';
    if (te) s += te === 1 ? 'じゅう' : D1[te] + 'じゅう';
    if (on) s += D1[on];
    return s;
  }
  function read(n) {
    n = Math.floor(n);
    if (n === 0) return 'ぜろ';
    const oku = Math.floor(n / 1e8), man = Math.floor(n / 1e4) % 1e4, rest = n % 1e4;
    let s = '';
    if (oku) s += under(oku, true) + 'おく';
    if (man) s += under(man, true) + 'まん';
    if (rest) s += under(rest);
    return s;
  }
  function kunder(n) {
    let s = '';
    const th = Math.floor(n / 1000), hu = Math.floor(n / 100) % 10, te = Math.floor(n / 10) % 10, on = n % 10;
    if (th) s += (th > 1 ? KD[th] : '') + '千';
    if (hu) s += (hu > 1 ? KD[hu] : '') + '百';
    if (te) s += (te > 1 ? KD[te] : '') + '十';
    if (on) s += KD[on];
    return s;
  }
  function kanji(n) {
    if (n === 0) return '〇';
    const oku = Math.floor(n / 1e8), man = Math.floor(n / 1e4) % 1e4, rest = n % 1e4;
    let s = '';
    if (oku) s += (oku === 1 ? '一' : kunder(oku)) + '億';
    if (man) s += (man === 1 ? '一' : man >= 1000 && Math.floor(man / 1000) === 1 ? '一' + kunder(man) : kunder(man)) + '万';
    if (rest) s += kunder(rest);
    return s;
  }
  const fmt = (n) => n.toLocaleString('en-US');
  function yen(n) { return read(n).replace(/よん$/, 'よ') + 'えん'; }

  const HOURS = ['', 'いちじ', 'にじ', 'さんじ', 'よじ', 'ごじ', 'ろくじ', 'しちじ', 'はちじ', 'くじ', 'じゅうじ', 'じゅういちじ', 'じゅうにじ'];
  const MIN = ['', 'いっぷん', 'にふん', 'さんぷん', 'よんぷん', 'ごふん', 'ろっぷん', 'ななふん', 'はっぷん', 'きゅうふん'];
  function minute(m) {
    if (!m) return '';
    const t = Math.floor(m / 10), o = m % 10;
    if (o === 0) return (t === 1 ? '' : D1[t]) + 'じゅっぷん';
    return (t ? (t === 1 ? '' : D1[t]) + 'じゅう' : '') + MIN[o];
  }
  function time(hh, mm, half = false) { return HOURS[hh] + (mm === 30 && half ? 'はん' : minute(mm)); }

  const MONTHS = ['', 'いちがつ', 'にがつ', 'さんがつ', 'しがつ', 'ごがつ', 'ろくがつ', 'しちがつ', 'はちがつ', 'くがつ', 'じゅうがつ', 'じゅういちがつ', 'じゅうにがつ'];
  const DAYS = ['', 'ついたち', 'ふつか', 'みっか', 'よっか', 'いつか', 'むいか', 'なのか', 'ようか', 'ここのか', 'とおか',
    'じゅういちにち', 'じゅうににち', 'じゅうさんにち', 'じゅうよっか', 'じゅうごにち', 'じゅうろくにち', 'じゅうしちにち', 'じゅうはちにち', 'じゅうくにち', 'はつか',
    'にじゅういちにち', 'にじゅうににち', 'にじゅうさんにち', 'にじゅうよっか', 'にじゅうごにち', 'にじゅうろくにち', 'にじゅうしちにち', 'にじゅうはちにち', 'にじゅうくにち', 'さんじゅうにち', 'さんじゅういちにち'];
  const WEEK = [['日曜日', 'にちようび', '일요일'], ['月曜日', 'げつようび', '월요일'], ['火曜日', 'かようび', '화요일'], ['水曜日', 'すいようび', '수요일'], ['木曜日', 'もくようび', '목요일'], ['金曜日', 'きんようび', '금요일'], ['土曜日', 'どようび', '토요일']];
  const RELDAY = [['一昨日', 'おととい', '그저께'], ['昨日', 'きのう', '어제'], ['今日', 'きょう', '오늘'], ['明日', 'あした', '내일'], ['明後日', 'あさって', '모레'], ['先週', 'せんしゅう', '지난주'], ['今週', 'こんしゅう', '이번 주'], ['来週', 'らいしゅう', '다음 주'], ['先月', 'せんげつ', '지난달'], ['今月', 'こんげつ', '이번 달'], ['来月', 'らいげつ', '다음 달'], ['去年', 'きょねん', '작년'], ['今年', 'ことし', '올해'], ['来年', 'らいねん', '내년'], ['毎日', 'まいにち', '매일'], ['毎朝', 'まいあさ', '매일 아침'], ['毎晩', 'まいばん', '매일 밤']];

  // [조수사, 한국어, 세는 것, 1~10 읽기]
  const COUNTERS = [
    ['つ', '개 (고유어 수사)', '물건 일반·나이·질문', 'ひとつ ふたつ みっつ よっつ いつつ むっつ ななつ やっつ ここのつ とお'],
    ['人', '명', '사람', 'ひとり ふたり さんにん よにん ごにん ろくにん しちにん はちにん きゅうにん じゅうにん'],
    ['本', '자루·병·그루', '가늘고 긴 것 (펜·우산·병·나무)', 'いっぽん にほん さんぼん よんほん ごほん ろっぽん ななほん はっぽん きゅうほん じゅっぽん'],
    ['枚', '장', '얇고 평평한 것 (종이·셔츠·접시)', 'いちまい にまい さんまい よんまい ごまい ろくまい ななまい はちまい きゅうまい じゅうまい'],
    ['匹', '마리', '작은 동물 (개·고양이·물고기)', 'いっぴき にひき さんびき よんひき ごひき ろっぴき ななひき はっぴき きゅうひき じゅっぴき'],
    ['冊', '권', '책·공책', 'いっさつ にさつ さんさつ よんさつ ごさつ ろくさつ ななさつ はっさつ きゅうさつ じゅっさつ'],
    ['個', '개', '작은 물건 (계란·지우개)', 'いっこ にこ さんこ よんこ ごこ ろっこ ななこ はっこ きゅうこ じゅっこ'],
    ['台', '대', '기계·차량', 'いちだい にだい さんだい よんだい ごだい ろくだい ななだい はちだい きゅうだい じゅうだい'],
    ['杯', '잔·그릇', '음료·밥', 'いっぱい にはい さんばい よんはい ごはい ろっぱい ななはい はっぱい きゅうはい じゅっぱい'],
    ['回', '번·회', '횟수', 'いっかい にかい さんかい よんかい ごかい ろっかい ななかい はっかい きゅうかい じゅっかい'],
    ['階', '층', '건물의 층', 'いっかい にかい さんがい よんかい ごかい ろっかい ななかい はっかい きゅうかい じゅっかい'],
    ['歳', '살', '나이 (20살 = はたち)', 'いっさい にさい さんさい よんさい ごさい ろくさい ななさい はっさい きゅうさい じゅっさい'],
    ['足', '켤레', '신발·양말', 'いっそく にそく さんぞく よんそく ごそく ろくそく ななそく はっそく きゅうそく じゅっそく'],
    ['軒', '채', '집·가게', 'いっけん にけん さんげん よんけん ごけん ろっけん ななけん はっけん きゅうけん じゅっけん'],
    ['着', '벌', '옷', 'いっちゃく にちゃく さんちゃく よんちゃく ごちゃく ろくちゃく ななちゃく はっちゃく きゅうちゃく じゅっちゃく'],
    ['分', '분', '시간의 분', 'いっぷん にふん さんぷん よんぷん ごふん ろっぷん ななふん はっぷん きゅうふん じゅっぷん'],
    ['時間', '시간', '기간', 'いちじかん にじかん さんじかん よじかん ごじかん ろくじかん ななじかん はちじかん くじかん じゅうじかん'],
    ['週間', '주', '기간', 'いっしゅうかん にしゅうかん さんしゅうかん よんしゅうかん ごしゅうかん ろくしゅうかん ななしゅうかん はっしゅうかん きゅうしゅうかん じゅっしゅうかん'],
    ['か月', '개월', '기간', 'いっかげつ にかげつ さんかげつ よんかげつ ごかげつ ろっかげつ ななかげつ はっかげつ きゅうかげつ じゅっかげつ'],
    ['年', '년', '기간·연도', 'いちねん にねん さんねん よねん ごねん ろくねん ななねん はちねん きゅうねん じゅうねん'],
    ['番', '번', '순서·번호', 'いちばん にばん さんばん よんばん ごばん ろくばん ななばん はちばん きゅうばん じゅうばん'],
    ['円', '엔', '돈', 'いちえん にえん さんえん よえん ごえん ろくえん ななえん はちえん きゅうえん じゅうえん'],
  ].map(([c, ko, what, t]) => ({ c, ko, what, t: t.split(' ') }));
  const CBY = Object.fromEntries(COUNTERS.map((x) => [x.c, x]));
  // 무엇을 셀 때 어떤 조수사? [한국어 대상, 이모지, 조수사]
  const THINGS = [
    ['연필', '✏️', '本'], ['우산', '☂️', '本'], ['맥주 (병)', '🍾', '本'], ['나무', '🌳', '本'], ['종이', '📄', '枚'], ['셔츠', '👕', '枚'],
    ['우표', '📮', '枚'], ['접시', '🍽️', '枚'], ['고양이', '🐈', '匹'], ['물고기', '🐟', '匹'], ['강아지', '🐕', '匹'], ['책', '📕', '冊'],
    ['공책', '📓', '冊'], ['자동차', '🚗', '台'], ['컴퓨터', '💻', '台'], ['자전거', '🚲', '台'], ['커피 (잔)', '☕', '杯'], ['밥 (그릇)', '🍚', '杯'],
    ['학생', '🧑‍🎓', '人'], ['신발', '👟', '足'], ['양말', '🧦', '足'], ['집', '🏠', '軒'], ['가게', '🏪', '軒'], ['양복', '🤵', '着'],
    ['계란', '🥚', '個'], ['지우개', '🧽', '個'], ['건물의 층', '🏢', '階'], ['나이', '🎂', '歳'], ['여행 횟수', '✈️', '回'],
  ];

  // 일본어 학습자가 자주 하는 음 변화 실수
  const HBP = { 'は': 'ばぱ', 'ひ': 'びぴ', 'ふ': 'ぶぷ', 'へ': 'べぺ', 'ほ': 'ぼぽ', 'ば': 'はぱ', 'び': 'ひぴ', 'ぶ': 'ふぷ', 'べ': 'へぺ', 'ぼ': 'ほぽ', 'ぱ': 'はば', 'ぴ': 'ひび', 'ぷ': 'ふぶ', 'ぺ': 'へべ', 'ぽ': 'ほぼ', 'か': 'が', 'が': 'か', 'さ': 'ざ', 'ざ': 'さ', 'せ': 'ぜ', 'ぜ': 'せ', 'げ': 'け', 'け': 'げ', 'そ': 'ぞ', 'ぞ': 'そ' };
  function soundVariants(s) {
    const out = new Set();
    const ch = [...s];
    ch.forEach((c, i) => {
      for (const alt of HBP[c] || '') { const x = ch.slice(); x[i] = alt; out.add(x.join('')); }
    });
    const swaps = [['いっ', 'いち'], ['ろっ', 'ろく'], ['はっ', 'はち'], ['じゅっ', 'じゅう'], ['いち', 'いっ'], ['ろく', 'ろっ'], ['はち', 'はっ'], ['じゅう', 'じゅっ'], ['よん', 'よ'], ['よ', 'よん'], ['しち', 'なな'], ['なな', 'しち'], ['く', 'きゅう'], ['きゅう', 'く'], ['し', 'よん'], ['よっか', 'よんにち'], ['ようか', 'はちにち'], ['なのか', 'ななにち'], ['はつか', 'にじゅうにち'], ['ここのか', 'きゅうにち'], ['とおか', 'じゅうにち'], ['ついたち', 'いちにち'], ['ふつか', 'ににち'], ['みっか', 'さんにち'], ['いつか', 'ごにち'], ['むいか', 'ろくにち']];
    for (const [a, b] of swaps) { const i = s.indexOf(a); if (i >= 0) out.add(s.slice(0, i) + b + s.slice(i + a.length)); }
    out.delete(s);
    return [...out];
  }
  function counterRead(c, n) { const C = CBY[c]; return C ? C.t[n - 1] : ''; }

  return { read, kanji, fmt, yen, time, minute, HOURS, MONTHS, DAYS, WEEK, RELDAY, COUNTERS, CBY, THINGS, soundVariants, counterRead, D1 };
})();

(function () {
  const { h, util, jp } = App;
  const N = App.num;
  const jpS = (s) => `<span class="jp" lang="ja">${util.esc(s)}</span>`;
  const opt4 = (right, cands) => util.uniq([right].concat(util.shuffle(cands.filter((x) => x && x !== right)))).slice(0, 4);

  /* ───────── 문제 생성 ───────── */
  function randNum(level) {
    const r = Math.random();
    if (level === 'easy') return 1 + Math.floor(Math.random() * 99);
    if (level === 'mid') {
      const base = [100, 300, 600, 800, 1000, 3000, 8000][Math.floor(Math.random() * 7)];
      return r < 0.5 ? base + Math.floor(Math.random() * 99) : 100 + Math.floor(Math.random() * 9900);
    }
    return r < 0.4 ? 10000 + Math.floor(Math.random() * 990000) : r < 0.8 ? 1000 + Math.floor(Math.random() * 9000) : 1e6 + Math.floor(Math.random() * 9e7);
  }
  function nearNums(n) {
    const s = String(n).split('');
    const out = new Set();
    for (let k = 0; k < 8; k++) {
      const x = s.slice();
      const i = Math.floor(Math.random() * x.length);
      x[i] = String((+x[i] + 1 + Math.floor(Math.random() * 8)) % 10);
      if (x[0] !== '0') out.add(+x.join(''));
    }
    if (s.length > 1) { const x = s.slice(); [x[0], x[1]] = [x[1], x[0]]; if (x[0] !== '0') out.add(+x.join('')); }
    out.delete(n);
    return [...out];
  }

  const G = {
    read(level) {
      const n = randNum(level);
      const r = N.read(n);
      const opts = opt4(r, N.soundVariants(r).concat(nearNums(n).map(N.read)));
      if (opts.length < 4) return null;
      return {
        kind: 'choice', title: '숫자를 바르게 읽은 것은?', tts: r,
        q: { html: `<span class="num-big">${N.fmt(n)}</span>`, big: true, sub: jpS(N.kanji(n)) },
        opts: util.shuffle(opts).map((x) => ({ html: jpS(x), val: x, tts: x })), ans: r, cols: 1,
        explain: `${N.fmt(n)} = ${jpS(r)}`,
      };
    },
    listen(level) {
      if (!App.ex.canListen()) return G.read(level);
      const n = randNum(level);
      const r = N.read(n);
      const opts = util.uniq([n].concat(util.shuffle(nearNums(n)))).slice(0, 4);
      if (opts.length < 4) return null;
      return {
        kind: 'choice', title: '들리는 숫자를 고르세요', tts: r, listen: true,
        q: { audio: r, hideText: true },
        opts: util.shuffle(opts).map((x) => ({ html: `<b>${N.fmt(x)}</b>`, val: String(x) })), ans: String(n), cols: 2,
        explain: `${N.fmt(n)} = ${jpS(r)}`,
      };
    },
    kanji(level) {
      const n = randNum(level === 'easy' ? 'mid' : level);
      const opts = util.uniq([n].concat(util.shuffle(nearNums(n)))).slice(0, 4);
      if (opts.length < 4) return null;
      return {
        kind: 'choice', title: '한자 숫자를 아라비아 숫자로', tts: N.read(n),
        q: { html: `<span class="jp num-kanji" lang="ja">${N.kanji(n)}</span>`, big: true },
        opts: util.shuffle(opts).map((x) => ({ html: `<b>${N.fmt(x)}</b>`, val: String(x) })), ans: String(n), cols: 2,
        explain: `${jpS(N.kanji(n))} = ${N.fmt(n)} (${jpS(N.read(n))})`,
      };
    },
    counter() {
      const C = util.pick(N.COUNTERS.filter((c) => c.c !== '円' || Math.random() < 0.5));
      const n = 1 + Math.floor(Math.random() * 10);
      const right = C.t[n - 1];
      const others = N.COUNTERS.filter((x) => x !== C).map((x) => x.t[n - 1]);
      const regular = C.c === 'つ' || C.c === '人' ? '' : (n === 10 ? 'じゅう' : N.D1[n]) + C.t[1].replace(/^に/, '');
      const opts = opt4(right, [regular].concat(N.soundVariants(right), util.shuffle(others)));
      if (opts.length < 4) return null;
      return {
        kind: 'choice', title: '조수사 읽기', tts: right,
        q: { html: `<span class="jp num-big" lang="ja">${n}${util.esc(C.c)}</span>`, big: true, sub: `${util.esc(C.what)} · ${n} ${util.esc(C.ko)}` },
        opts: util.shuffle(opts).map((x) => ({ html: jpS(x), val: x, tts: x })), ans: right, cols: 2,
        explain: `${n}${util.esc(C.c)} = ${jpS(right)}<br><small>${C.t.map((x, i) => (i + 1) + ':' + x).join(' · ')}</small>`,
      };
    },
    cpick() {
      const [thing, emo, c] = util.pick(N.THINGS);
      const n = 2 + Math.floor(Math.random() * 4);
      const others = util.sample(N.COUNTERS.filter((x) => x.c !== c && x.c !== 'つ' && !(c === '個' && x.c === 'つ')), 3);
      const C = N.CBY[c];
      return {
        kind: 'choice', title: '알맞은 조수사를 고르세요', tts: C.t[n - 1],
        q: { html: `<span class="emo-big">${emo}</span><div class="ko-q">${util.esc(thing)} ${n}${util.esc(C.ko.split('·')[0])}</div>`, big: true },
        opts: util.shuffle([C].concat(others)).map((x) => ({ html: `<span class="jp" lang="ja">${n}${util.esc(x.c)}</span> <small class="muted">${util.esc(x.t[n - 1])}</small>`, val: x.c })), ans: c, cols: 2,
        explain: `${util.esc(thing)} → <b lang="ja">${util.esc(c)}</b> (${util.esc(C.what)}) · <span lang="ja">${n}${util.esc(c)} = ${util.esc(C.t[n - 1])}</span>`,
      };
    },
    date() {
      const m = 1 + Math.floor(Math.random() * 12);
      const d = Math.random() < 0.6 ? util.pick([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 20, 24]) : 1 + Math.floor(Math.random() * 28);
      const right = N.MONTHS[m] + N.DAYS[d];
      const wrongM = { 4: 'よんがつ', 7: 'なながつ', 9: 'きゅうがつ' }[m];
      const cands = N.soundVariants(right).concat(wrongM ? [wrongM + N.DAYS[d]] : [], [N.MONTHS[m] + N.DAYS[(d % 28) + 1], N.MONTHS[(m % 12) + 1] + N.DAYS[d]]);
      const opts = opt4(right, cands);
      if (opts.length < 4) return null;
      return {
        kind: 'choice', title: '날짜를 바르게 읽은 것은?', tts: right,
        q: { html: `<span class="jp num-big" lang="ja">${m}月${d}日</span>`, big: true, sub: `${m}월 ${d}일` },
        opts: util.shuffle(opts).map((x) => ({ html: jpS(x), val: x, tts: x })), ans: right, cols: 1,
        explain: `${m}月${d}日 = ${jpS(right)}${d <= 10 || d === 14 || d === 20 || d === 24 ? '<br><small>⚠️ 1~10일, 14일, 20일, 24일은 고유어 읽기</small>' : ''}`,
      };
    },
    time() {
      const hh = 1 + Math.floor(Math.random() * 12);
      const mm = util.pick([0, 1, 3, 4, 5, 6, 8, 10, 15, 20, 30, 33, 40, 45, 50, 56]);
      const right = N.time(hh, mm);
      const cands = N.soundVariants(right).concat([N.time((hh % 12) + 1, mm), N.time(hh, (mm + 5) % 60)]);
      const opts = opt4(right, cands);
      if (opts.length < 4) return null;
      const txt = `${hh}時${mm ? mm + '分' : ''}`;
      return {
        kind: 'choice', title: '시각을 바르게 읽은 것은?', tts: right,
        q: { html: `<span class="jp num-big" lang="ja">${txt}</span>`, big: true, sub: `${hh}시 ${mm ? mm + '분' : '정각'}` },
        opts: util.shuffle(opts).map((x) => ({ html: jpS(x), val: x, tts: x })), ans: right, cols: 1,
        explain: `${txt} = ${jpS(right)}${mm === 30 ? `<br><small>30분은 <span lang="ja">${N.HOURS[hh]}はん(半)</span>이라고도 해요</small>` : ''}`,
      };
    },
    timeListen() {
      if (!App.ex.canListen()) return G.time();
      const hh = 1 + Math.floor(Math.random() * 12);
      const mm = util.pick([5, 10, 15, 20, 25, 30, 40, 45, 50]);
      const right = `${hh}:${String(mm).padStart(2, '0')}`;
      const p2 = (x) => String(x).padStart(2, '0');
      const cands = [`${(hh % 12) + 1}:${p2(mm)}`, `${((hh + 10) % 12) + 1}:${p2(mm)}`, `${hh}:${p2((mm + 10) % 60)}`, `${hh}:${p2(mm - 5)}`];
      const opts = opt4(right, cands);
      return {
        kind: 'choice', title: '들리는 시각을 고르세요', tts: N.time(hh, mm), listen: true,
        q: { audio: N.time(hh, mm), hideText: true },
        opts: util.shuffle(opts).map((x) => ({ html: `<b>${x}</b>`, val: x })), ans: right, cols: 2,
        explain: `${right} = ${jpS(N.time(hh, mm))}`,
      };
    },
    week() {
      const i = Math.floor(Math.random() * 7);
      const [w, r, ko] = N.WEEK[i];
      const rev = Math.random() < 0.5;
      const others = util.sample(N.WEEK.filter((x, j) => j !== i), 3);
      if (rev) return {
        kind: 'choice', title: '요일의 일본어는?', tts: r,
        q: { html: `<span class="ko-q">${ko}</span>`, big: true },
        opts: util.shuffle([N.WEEK[i]].concat(others)).map((x) => ({ html: `<span class="jp" lang="ja">${jp.ruby(jp.align(x[0], x[1]))}</span>`, val: x[0], tts: x[1] })), ans: w, cols: 2,
        explain: `${ko} = <b lang="ja">${w}</b> (${r})`,
      };
      return {
        kind: 'choice', title: '무슨 요일일까요?', tts: r,
        q: { html: `<span class="jp" lang="ja">${util.esc(w)}</span>`, big: true, audio: r },
        opts: util.shuffle([N.WEEK[i]].concat(others)).map((x) => ({ html: util.esc(x[2]), val: x[0] })), ans: w, cols: 2,
        explain: `<b lang="ja">${w}</b> (${r}) = ${ko}`,
      };
    },
    rel() {
      const i = Math.floor(Math.random() * N.RELDAY.length);
      const [w, r, ko] = N.RELDAY[i];
      const others = util.sample(N.RELDAY.filter((x, j) => j !== i), 3);
      return {
        kind: 'choice', title: '알맞은 뜻을 고르세요', tts: r,
        q: { html: `<span class="jp" lang="ja">${jp.ruby(jp.align(w, r))}</span>`, big: true, audio: r },
        opts: util.shuffle([N.RELDAY[i]].concat(others)).map((x) => ({ html: util.esc(x[2]), val: x[0] })), ans: w, cols: 2,
        explain: `<b lang="ja">${w}</b> (${r}) = ${ko}`,
      };
    },
    price() {
      const n = util.pick([4, 14, 40, 104, 140, 300, 380, 600, 680, 800, 980, 1000, 1400, 3000, 3800, 8000, 12000, 25800, 100000]) + (Math.random() < 0.3 ? 0 : 0);
      const right = N.yen(n);
      if (!App.ex.canListen() || Math.random() < 0.4) {
        const opts = opt4(right, N.soundVariants(right).concat(nearNums(n).map(N.yen), [N.read(n) + 'えん']));
        if (opts.length < 4) return null;
        return {
          kind: 'choice', title: '가격을 바르게 읽은 것은?', tts: right,
          q: { html: `<span class="num-big">${N.fmt(n)}円</span>`, big: true },
          opts: util.shuffle(opts).map((x) => ({ html: jpS(x), val: x, tts: x })), ans: right, cols: 1,
          explain: `${N.fmt(n)}円 = ${jpS(right)}${/4$/.test(String(n)) ? '<br><small>⚠️ 끝자리 4円은 よえん</small>' : ''}`,
        };
      }
      const opts = util.uniq([n].concat(util.shuffle(nearNums(n)))).slice(0, 4);
      return {
        kind: 'choice', title: '들리는 가격을 고르세요', tts: right, listen: true,
        q: { audio: right, hideText: true },
        opts: util.shuffle(opts).map((x) => ({ html: `<b>${N.fmt(x)}円</b>`, val: String(x) })), ans: String(n), cols: 2,
        explain: `${N.fmt(n)}円 = ${jpS(right)}`,
      };
    },
  };

  const DRILLS = {
    read: ['숫자 읽기', ['read', 'read', 'kanji', 'listen'], 'mid'],
    big: ['큰 숫자 (만·억)', ['read', 'kanji', 'listen'], 'big'],
    listen: ['숫자 듣기', ['listen', 'price', 'timeListen'], 'mid'],
    counter: ['조수사', ['counter', 'counter', 'cpick'], 'mid'],
    date: ['날짜·요일', ['date', 'date', 'week', 'rel'], 'mid'],
    time: ['시각', ['time', 'time', 'timeListen'], 'mid'],
    price: ['가격', ['price'], 'mid'],
    mix: ['종합', ['read', 'listen', 'kanji', 'counter', 'cpick', 'date', 'time', 'week', 'price', 'rel'], 'mid'],
  };
  App.drills.num = ([type = 'mix']) => {
    const d = DRILLS[type] || DRILLS.mix;
    const list = [];
    let guard = 0;
    const seen = new Set();
    while (list.length < 15 && guard++ < 200) {
      const e = G[util.pick(d[1])](d[2]);
      if (!e) continue;
      const k = e.title + e.ans;
      if (seen.has(k)) continue;
      seen.add(k);
      list.push(e);
    }
    return { title: `숫자 트레이닝 · ${d[0]}`, list, xp: 10 };
  };

  /* ───────── 화면 ───────── */
  App.screens.numbers = function (args, query) {
    const el = h('div.pad');
    el.appendChild(App.train.hero('🔢', '숫자·시간·날짜 트레이너', '숫자 읽기의 음 변화(さんびゃく·ろっぴゃく…), 시각, 날짜, 조수사를 표로 익히고 연습해요.'));
    el.appendChild(h('div.section-title', '연습 시작'));
    const list = h('div.menu-list');
    for (const [k, [t, , ]] of Object.entries(DRILLS)) {
      const sub = { read: '100~9,999 읽기·한자 숫자', big: '만(まん)·억(おく) 단위', listen: '숫자·가격·시각 받아 듣기', counter: '本·匹·杯 등 음 변화', date: 'ついたち·ふつか·요일·어제/내일', time: '〜時〜分, ぷん/ふん', price: '〜円, 4円=よえん', mix: '모든 유형 섞어서' }[k];
      list.appendChild(App.train.startRow(t, sub, `lesson/drill/num/${k}`, { read: '①', big: '万', listen: '🎧', counter: '本', date: '📅', time: '⏰', price: '円', mix: '⚡' }[k]));
    }
    el.appendChild(list);

    // 변환기
    el.appendChild(h('div.section-title', '숫자 읽기 변환기'));
    const inp = h('input.search', { type: 'number', inputmode: 'numeric', placeholder: '숫자를 입력하세요 (예: 3600)', min: '0', max: '999999999999' });
    const out = h('div.num-out');
    const run = () => {
      const n = Math.floor(Number(inp.value));
      out.innerHTML = '';
      if (!inp.value || !(n >= 0) || n > 999999999999) return;
      const r = N.read(n);
      out.append(h('div.no-n', N.fmt(n)), h('div.no-k', { lang: 'ja' }, N.kanji(n)), h('div.no-r', { lang: 'ja' }, r),
        h('div.row.gap.center-row', App.views.speakBtn(r, '🔊 듣기', 'wide'), App.views.speakBtn(N.yen(n), '🔊 〜円', 'wide')));
    };
    inp.addEventListener('input', run);
    el.append(inp, out);

    // 음 변화 표
    el.appendChild(h('div.section-title', '음이 바뀌는 숫자'));
    el.appendChild(App.train.fold(h('div', h('div.g-pat', '百 · 千 · 万'), h('div.g-mean', '300·600·800·3000·8000 주의')), (body) => {
      const rows = [[100, 200, 300, 400, 500, 600, 700, 800, 900], [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000], [10000, 100000, 1000000, 10000000, 100000000]];
      for (const r of rows) {
        body.appendChild(h('div.num-table', r.map((n) => {
          const rd = N.read(n);
          const irr = /びゃく|ぴゃく|ぜん|っせん|っぴ/.test(rd);
          return h('button.nt-cell' + (irr ? '.irr' : ''), { type: 'button', onclick: () => App.tts.speak(rd) }, h('b', N.fmt(n)), h('span', { lang: 'ja' }, rd));
        })));
      }
      body.appendChild(h('div.g-exp', { html: '<p>⚠️ 4는 <span lang="ja">よん</span>, 7은 <span lang="ja">なな</span>, 9는 <span lang="ja">きゅう</span>가 기본이에요. 단, <span lang="ja">4時(よじ) · 7時(しちじ) · 9時(くじ) · 4月(しがつ) · 7月(しちがつ) · 9月(くがつ)</span>는 예외!</p>' }));
    }));
    el.appendChild(App.train.fold(h('div', h('div.g-pat', '시각 〜時 · 〜分'), h('div.g-mean', 'ふん / ぷん 구별')), (body) => {
      body.appendChild(h('div.num-table', N.HOURS.slice(1).map((r, i) => h('button.nt-cell' + ([4, 7, 9].includes(i + 1) ? '.irr' : ''), { type: 'button', onclick: () => App.tts.speak(r) }, h('b', `${i + 1}時`), h('span', { lang: 'ja' }, r)))));
      body.appendChild(h('div.num-table', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 45].map((m) => { const r = N.minute(m); return h('button.nt-cell' + (/ぷん/.test(r) ? '.irr' : ''), { type: 'button', onclick: () => App.tts.speak(r) }, h('b', `${m}分`), h('span', { lang: 'ja' }, r)); })));
      body.appendChild(h('div.g-exp', { html: '<p>1·3·4·6·8·10분은 <b>ぷん</b>, 나머지는 <b>ふん</b>. 오전 <span lang="ja">午前(ごぜん)</span>, 오후 <span lang="ja">午後(ごご)</span>, 반 <span lang="ja">半(はん)</span></p>' }));
    }));
    el.appendChild(App.train.fold(h('div', h('div.g-pat', '날짜 〜月 · 〜日 · 요일'), h('div.g-mean', '1~10일·14·20·24일은 특별한 읽기')), (body) => {
      body.appendChild(h('div.num-table', N.MONTHS.slice(1).map((r, i) => h('button.nt-cell' + ([4, 7, 9].includes(i + 1) ? '.irr' : ''), { type: 'button', onclick: () => App.tts.speak(r) }, h('b', `${i + 1}月`), h('span', { lang: 'ja' }, r)))));
      body.appendChild(h('div.num-table.days', N.DAYS.slice(1).map((r, i) => h('button.nt-cell' + (!/にち$/.test(r) ? '.irr' : ''), { type: 'button', onclick: () => App.tts.speak(r) }, h('b', `${i + 1}日`), h('span', { lang: 'ja' }, r)))));
      body.appendChild(h('div.num-table', N.WEEK.map(([w, r, ko]) => h('button.nt-cell', { type: 'button', onclick: () => App.tts.speak(r) }, h('b', { lang: 'ja' }, w), h('span', { lang: 'ja' }, r), h('small', ko)))));
      body.appendChild(h('div.num-table', N.RELDAY.map(([w, r, ko]) => h('button.nt-cell', { type: 'button', onclick: () => App.tts.speak(r) }, h('b', { lang: 'ja' }, w), h('span', { lang: 'ja' }, r), h('small', ko)))));
    }));

    el.appendChild(h('div.section-title', '조수사 표 (1~10)'));
    for (const C of N.COUNTERS) {
      el.appendChild(App.train.fold(h('div', h('div.g-pat', { lang: 'ja' }, C.c), h('div.g-mean', `${C.ko} — ${C.what}`)), (body) => {
        const base = C.c === '人' ? 'にん' : C.t[1].replace(/^に/, '');
        body.appendChild(h('div.num-table', C.t.map((r, i) => {
          const irr = C.c === 'つ' || r !== (i === 9 ? 'じゅう' : N.D1[i + 1]) + base;
          return h('button.nt-cell' + (irr ? '.irr' : ''), { type: 'button', onclick: () => App.tts.speak(r) }, h('b', { lang: 'ja' }, `${i + 1}${C.c}`), h('span', { lang: 'ja' }, r));
        })));
        body.appendChild(h('p.small.muted', '🟧 표시는 소리가 바뀌는 것(촉음·탁음·반탁음·특수 읽기)이에요.'));
      }));
    }
    return { el, title: '숫자·시간·날짜', back: true, tab: 'home', study: true };
  };
})();
