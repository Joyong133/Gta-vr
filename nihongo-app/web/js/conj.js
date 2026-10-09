/* 동사·형용사 활용 엔진 + 활용 연습 문제 생성 */
'use strict';

App.conj = (function () {
  const { util, jp } = App;
  const D = window.JPDATA || {};
  const LV = ['n5', 'n4', 'n3', 'n2', 'n1'];

  const verbs = (D.verbs || []).map(([w, r, m, g, lv, no]) => ({
    id: 'cv:' + w, w, r, m, g, lv, no: new Set((no || '').split(',').filter(Boolean)),
    kuru: g === 3 && r.endsWith('くる'),
  }));
  const adjs = (D.adjs || []).map(([w, r, m, t, lv]) => ({ id: 'ca:' + w, w, r, m, t, lv }));

  /* ───────── 동사 ───────── */
  const ROW = {
    'う': 'わいえお', 'く': 'かきけこ', 'ぐ': 'がぎげご', 'す': 'さしせそ', 'つ': 'たちてと',
    'ぬ': 'なにねの', 'ぶ': 'ばびべぼ', 'む': 'まみめも', 'る': 'らりれろ',
  };
  const TE = { 'う': 'って', 'つ': 'って', 'る': 'って', 'く': 'いて', 'ぐ': 'いで', 'す': 'して', 'ぬ': 'んで', 'ぶ': 'んで', 'む': 'んで' };
  const HON = { 'いらっしゃる': 1, 'おっしゃる': 1, 'くださる': 1, 'なさる': 1 };

  // [키, 이름, 뜻, 레벨]
  const FORMS = [
    ['masu', 'ます형', '~합니다', 'n5'],
    ['masen', 'ません', '~하지 않습니다', 'n5'],
    ['mashita', 'ました', '~했습니다', 'n5'],
    ['masendeshita', 'ませんでした', '~하지 않았습니다', 'n5'],
    ['mashou', 'ましょう', '~합시다', 'n5'],
    ['te', 'て형', '~하고 / ~해서', 'n5'],
    ['ta', 'た형(과거)', '~했다', 'n5'],
    ['nai', 'ない형(부정)', '~하지 않다', 'n5'],
    ['nakatta', 'なかった', '~하지 않았다', 'n5'],
    ['tai', 'たい(희망)', '~하고 싶다', 'n5'],
    ['teiru', 'ている', '~하고 있다', 'n5'],
    ['nagara', 'ながら', '~하면서', 'n4'],
    ['pot', '가능형', '~할 수 있다', 'n4'],
    ['vol', '의지형', '~하자 / ~하려고', 'n4'],
    ['ba', 'ば 가정형', '~하면', 'n4'],
    ['tara', 'たら 가정', '~하면 / ~했더니', 'n4'],
    ['imp', '명령형', '~해라', 'n4'],
    ['proh', '금지형', '~하지 마라', 'n4'],
    ['pass', '수동형', '~당하다 / ~되다', 'n4'],
    ['caus', '사역형', '~하게 하다 / 시키다', 'n4'],
    ['causpass', '사역수동형', '(억지로) ~하게 되다', 'n4'],
    ['zu', 'ず(문어 부정)', '~하지 않고', 'n3'],
  ];
  const FORM = Object.fromEntries(FORMS.map((f) => [f[0], { key: f[0], name: f[1], ko: f[2], lv: f[3] }]));

  // 그룹별 규칙 설명 + 예문
  const RULES = {
    masu: ['う단 → い단 + ます (書く → 書きます)', 'る를 떼고 + ます (食べる → 食べます)', 'する → します · 来る → 来[き]ます', ['毎朝[まいあさ] コーヒーを 飲[の]みます。', '매일 아침 커피를 마십니다.']],
    masen: ['う단 → い단 + ません', 'る → ません', 'しません · 来[き]ません', ['肉[にく]は 食[た]べません。', '고기는 먹지 않습니다.']],
    mashita: ['う단 → い단 + ました', 'る → ました', 'しました · 来[き]ました', ['昨日[きのう] 映画[えいが]を 見[み]ました。', '어제 영화를 봤습니다.']],
    masendeshita: ['う단 → い단 + ませんでした', 'る → ませんでした', 'しませんでした · 来[き]ませんでした', ['宿題[しゅくだい]を しませんでした。', '숙제를 하지 않았습니다.']],
    mashou: ['う단 → い단 + ましょう', 'る → ましょう', 'しましょう · 来[き]ましょう', ['一緒[いっしょ]に 帰[かえ]りましょう。', '같이 돌아갑시다.']],
    te: ['う·つ·る → って / む·ぶ·ぬ → んで / く → いて / ぐ → いで / す → して<br>⚠️ 예외: 行く → 行って', 'る → て (食べる → 食べて)', 'して · 来[き]て', ['窓[まど]を 開[あ]けて ください。', '창문을 열어 주세요.']],
    ta: ['て형의 て/で → た/だ (書いて → 書いた, 読んで → 読んだ)', 'る → た', 'した · 来[き]た', ['昨日[きのう] 友達[ともだち]に 会[あ]った。', '어제 친구를 만났다.']],
    nai: ['う단 → あ단 + ない (う는 わ: 買う → 買わない)<br>⚠️ 예외: ある → ない', 'る → ない', 'しない · 来[こ]ない', ['今日[きょう]は 学校[がっこう]へ 行[い]かない。', '오늘은 학교에 가지 않는다.']],
    nakatta: ['ない형의 ない → なかった', 'る → なかった', 'しなかった · 来[こ]なかった', ['誰[だれ]も 来[こ]なかった。', '아무도 오지 않았다.']],
    tai: ['ます형 어간(い단) + たい', 'る → たい', 'したい · 来[き]たい', ['日本[にほん]へ 行[い]きたいです。', '일본에 가고 싶어요.']],
    teiru: ['て형 + いる (진행·결과 상태)', 'る → ている', 'している · 来[き]ている', ['弟[おとうと]は 今[いま] 本[ほん]を 読[よ]んで います。', '남동생은 지금 책을 읽고 있습니다.']],
    nagara: ['ます형 어간 + ながら', 'る → ながら', 'しながら · 来[き]ながら', ['音楽[おんがく]を 聞[き]きながら 勉強[べんきょう]します。', '음악을 들으면서 공부합니다.']],
    pot: ['う단 → え단 + る (書く → 書ける)', 'る → られる (食べる → 食べられる)', 'する → できる · 来[こ]られる', ['漢字[かんじ]が 少[すこ]し 読[よ]めます。', '한자를 조금 읽을 수 있어요.']],
    vol: ['う단 → お단 + う (書く → 書こう)', 'る → よう', 'しよう · 来[こ]よう', ['明日[あした]から 早[はや]く 起[お]きよう。', '내일부터 일찍 일어나자.']],
    ba: ['う단 → え단 + ば (急ぐ → 急げば)', 'る → れば', 'すれば · 来[く]れば', ['急[いそ]げば 間[ま]に合[あ]います。', '서두르면 시간에 맞출 수 있어요.']],
    tara: ['た형 + ら (書いた → 書いたら)', 'る → たら', 'したら · 来[き]たら', ['駅[えき]に 着[つ]いたら 電話[でんわ]して ください。', '역에 도착하면 전화해 주세요.']],
    imp: ['う단 → え단 (書く → 書け)', 'る → ろ (食べる → 食べろ)', 'しろ · 来[こ]い', ['早[はや]く 起[お]きろ！', '빨리 일어나!']],
    proh: ['사전형 + な', '사전형 + な', 'するな · 来[く]るな', ['ここで 写真[しゃしん]を 撮[と]るな。', '여기서 사진 찍지 마.']],
    pass: ['う단 → あ단 + れる (書く → 書かれる)', 'る → られる', 'される · 来[こ]られる', ['先生[せんせい]に 褒[ほ]められました。', '선생님께 칭찬받았어요.']],
    caus: ['う단 → あ단 + せる (書く → 書かせる)', 'る → させる', 'させる · 来[こ]させる', ['母[はは]は 弟[おとうと]に 野菜[やさい]を 食[た]べさせた。', '엄마는 남동생에게 채소를 먹게 했다.']],
    causpass: ['う단 → あ단 + される (書く → 書かされる)<br>す로 끝나면 + せられる (話す → 話させられる)', 'る → させられる', 'させられる · 来[こ]させられる', ['子[こ]どもの とき、ピアノを 習[なら]わされました。', '어릴 때 (억지로) 피아노를 배웠어요.']],
    zu: ['う단 → あ단 + ず (書く → 書かず)', 'る → ず', 'せず · 来[こ]ず', ['朝[あさ]ご飯[はん]を 食[た]べずに 出[で]かけた。', '아침밥을 먹지 않고 나갔다.']],
  };

  function sfx(stemK, stemR) { return (s, sR = s) => ({ w: stemK + s, r: stemR + sR }); }

  function verbForm(v, f) {
    if (v.no.has(f) || !FORM[f]) return null;
    const g = v.g;
    if (g === 3) {
      if (v.kuru) {
        const K = v.w.slice(0, -2), R = v.r.slice(0, -2);
        const mk = (k, r) => ({ w: K + '来' + k, r: R + r + k });
        const T = {
          masu: ['き', 'ます'], masen: ['き', 'ません'], mashita: ['き', 'ました'], masendeshita: ['き', 'ませんでした'], mashou: ['き', 'ましょう'],
          te: ['き', 'て'], ta: ['き', 'た'], nai: ['こ', 'ない'], nakatta: ['こ', 'なかった'], tai: ['き', 'たい'], teiru: ['き', 'ている'],
          nagara: ['き', 'ながら'], pot: ['こ', 'られる'], vol: ['こ', 'よう'], ba: ['く', 'れば'], tara: ['き', 'たら'], imp: ['こ', 'い'],
          proh: ['く', 'るな'], pass: ['こ', 'られる'], caus: ['こ', 'させる'], causpass: ['こ', 'させられる'], zu: ['こ', 'ず'],
        }[f];
        return T ? mk(T[1], T[0]) : null;
      }
      const S = sfx(v.w.slice(0, -2), v.r.slice(0, -2));
      const T = {
        masu: 'します', masen: 'しません', mashita: 'しました', masendeshita: 'しませんでした', mashou: 'しましょう',
        te: 'して', ta: 'した', nai: 'しない', nakatta: 'しなかった', tai: 'したい', teiru: 'している', nagara: 'しながら',
        pot: 'できる', vol: 'しよう', ba: 'すれば', tara: 'したら', imp: 'しろ', proh: 'するな', pass: 'される',
        caus: 'させる', causpass: 'させられる', zu: 'せず',
      }[f];
      return T ? S(T) : null;
    }
    if (g === 2) {
      const S = sfx(v.w.slice(0, -1), v.r.slice(0, -1));
      const T = {
        masu: 'ます', masen: 'ません', mashita: 'ました', masendeshita: 'ませんでした', mashou: 'ましょう',
        te: 'て', ta: 'た', nai: 'ない', nakatta: 'なかった', tai: 'たい', teiru: 'ている', nagara: 'ながら',
        pot: 'られる', vol: 'よう', ba: 'れば', tara: 'たら', imp: v.r === 'くれる' ? '' : 'ろ', proh: 'るな', pass: 'られる',
        caus: 'させる', causpass: 'させられる', zu: 'ず',
      }[f];
      return T == null ? null : S(T);
    }
    // 1그룹(5단)
    const u = v.r.slice(-1);
    const row = ROW[u];
    if (!row) return null;
    const S = sfx(v.w.slice(0, -1), v.r.slice(0, -1));
    const [a, i0, e, o] = row;
    const hon = HON[v.r];
    const i = hon ? 'い' : i0;
    let te = TE[u];
    if (v.r === 'いく' || v.r.endsWith('ていく')) te = 'って';
    const ta = te.replace('て', 'た').replace('で', 'だ');
    if (v.r === 'ある' && (f === 'nai' || f === 'nakatta')) return { w: f === 'nai' ? 'ない' : 'なかった', r: f === 'nai' ? 'ない' : 'なかった' };
    const T = {
      masu: i + 'ます', masen: i + 'ません', mashita: i + 'ました', masendeshita: i + 'ませんでした', mashou: i + 'ましょう',
      te, ta, nai: a + 'ない', nakatta: a + 'なかった', tai: i0 + 'たい', teiru: te + 'いる', nagara: i0 + 'ながら',
      pot: e + 'る', vol: o + 'う', ba: e + 'ば', tara: ta + 'ら', imp: hon ? 'い' : e, proh: u + 'な',
      pass: a + 'れる', caus: a + 'せる', causpass: u === 'す' ? a + 'せられる' : a + 'される', zu: a + 'ず',
    }[f];
    return T == null ? null : S(T);
  }

  // 같은 결과(수동=가능 등)로 정답이 여러 개가 되는 것을 막기 위한 대체 정답
  function verbAlts(v, f) {
    const alt = [];
    if (f === 'causpass' && v.g === 1 && v.r.slice(-1) !== 'す') {
      const x = verbForm(v, 'caus');
      if (x) alt.push({ w: x.w.slice(0, -1) + 'られる', r: x.r.slice(0, -1) + 'られる' });
    }
    if (f === 'teiru') { const x = verbForm(v, 'te'); if (x) alt.push({ w: x.w + 'る', r: x.r + 'る' }); }
    return alt;
  }

  function verbWrongs(v, f) {
    const right = verbForm(v, f);
    if (!right) return [];
    const out = [];
    const push = (x) => { if (x && x.r !== right.r && !out.some((y) => y.r === x.r)) out.push(x); };
    // 다른 그룹 규칙을 잘못 적용
    if (v.g === 1 && v.r.endsWith('る')) push(verbForm(Object.assign({}, v, { g: 2, no: new Set() }), f));
    if (v.g === 2) push(verbForm(Object.assign({}, v, { g: 1, no: new Set() }), f));
    if (v.g === 3 && !v.kuru) {
      const K = v.w.slice(0, -2), R = v.r.slice(0, -2);
      const W = { masu: ['すます', 'さます'], masen: ['すません'], mashita: ['すました'], masendeshita: ['すませんでした'], mashou: ['すましょう'], te: ['すて', 'さて'], ta: ['すた', 'さた'], nai: ['さない', 'すない', 'せない'], nakatta: ['さなかった', 'すなかった'], tai: ['すたい'], teiru: ['すている'], nagara: ['すながら'], pot: ['される', 'しれる', 'すられる'], vol: ['すよう', 'そう'], ba: ['せば', 'しれば'], tara: ['すたら'], imp: ['せろ', 'すれ'], proh: ['しな'], pass: ['しられる', 'すられる'], caus: ['しさせる', 'すさせる'], causpass: ['しさせられる', 'される'], zu: ['さず', 'しず'] }[f] || [];
      W.forEach((s) => push({ w: K + s, r: R + s }));
    }
    if (v.kuru) {
      const R = v.r.slice(0, -2), K = v.w.slice(0, -2);
      for (const k of ['こ', 'き', 'く']) {
        const x = { w: right.w, r: R + k + right.r.slice(R.length + 1) };
        push(x);
      }
    }
    // て형 계열: 다른 음편 적용
    if (v.g === 1 && ['te', 'ta', 'tara', 'teiru'].includes(f)) {
      const base = right.r.slice(0, v.r.length - 1);
      const tail = { te: '', ta: '', tara: 'ら', teiru: 'いる' }[f];
      const kanjiStem = v.w.slice(0, -1);
      for (const t of ['って', 'いて', 'んで', 'して', 'いで']) {
        let x = t;
        if (f === 'ta' || f === 'tara') x = t.replace('て', 'た').replace('で', 'だ');
        push({ w: kanjiStem + x + tail, r: base + x + tail });
      }
      push({ w: kanjiStem + ROW[v.r.slice(-1)][1] + (f === 'ta' || f === 'tara' ? 'た' : 'て') + tail, r: base + ROW[v.r.slice(-1)][1] + (f === 'ta' || f === 'tara' ? 'た' : 'て') + tail });
    }
    // 같은 동사의 다른 형태 (형태 구별 연습)
    const NEAR = {
      masu: ['masen', 'mashita', 'mashou'], masen: ['masendeshita', 'masu', 'nai'], mashita: ['masendeshita', 'masu', 'ta'],
      masendeshita: ['mashita', 'masen', 'nakatta'], mashou: ['masu', 'vol', 'mashita'], te: ['ta', 'teiru', 'tara'], ta: ['te', 'tara', 'mashita'],
      nai: ['nakatta', 'masen', 'zu'], nakatta: ['nai', 'masendeshita', 'ta'], tai: ['masu', 'nagara', 'te'], teiru: ['te', 'ta', 'masu'],
      nagara: ['tai', 'masu', 'te'], pot: ['pass', 'caus', 'ba'], vol: ['mashou', 'imp', 'pot'], ba: ['tara', 'pot', 'imp'], tara: ['ba', 'ta', 'te'],
      imp: ['vol', 'proh', 'ba'], proh: ['imp', 'nai', 'vol'], pass: ['caus', 'pot', 'causpass'], caus: ['pass', 'causpass', 'pot'],
      causpass: ['caus', 'pass', 'pot'], zu: ['nai', 'nakatta', 'pass'],
    }[f] || [];
    const alts = verbAlts(v, f);
    // ら抜き(食べれる)는 구어에서 흔하므로 오답 보기로 쓰지 않음
    if (f === 'pot' && v.g !== 1) alts.push({ r: right.r.replace(/られる$/, 'れる') });
    for (const n of NEAR) push(verbForm(v, n));
    return out.filter((x) => !alts.some((a) => a.r === x.r));
  }

  function groupOf(v) {
    if (v.g === 3) return '3그룹 (불규칙)';
    if (v.g === 2) return '2그룹 (1단)';
    return '1그룹 (5단)';
  }
  const IE = /[いきしちにひみりぎじびぴえけせてねへめれげぜべぺ]る$/;
  function groupWhy(v) {
    if (v.g === 3) return v.kuru ? '来る(くる)가 붙은 불규칙 동사예요.' : 'する가 붙은 불규칙 동사예요.';
    if (v.g === 2) return `る 바로 앞이 い단/え단(<span lang="ja">${util.esc(v.r.slice(-2, -1))}</span>)이라서 2그룹이에요.`;
    if (IE.test(v.r)) return `⚠️ る 앞이 い단/え단이지만 <b>예외 1그룹</b> 동사예요! (帰る·入る·走る·知る·切る와 같은 유형)`;
    if (v.r.endsWith('る')) return `る 앞이 あ·う·お단(<span lang="ja">${util.esc(v.r.slice(-2, -1))}</span>)이라서 1그룹이에요.`;
    return `<span lang="ja">${util.esc(v.r.slice(-1))}</span>로 끝나므로 1그룹이에요 (る 이외의 う단 끝).`;
  }

  /* ───────── 형용사 ───────── */
  const AFORMS = [
    ['neg', '부정', '~지 않다', 'n5'],
    ['past', '과거', '~었다', 'n5'],
    ['pastneg', '과거 부정', '~지 않았다', 'n5'],
    ['te', 'て형(연결)', '~고 / ~서', 'n5'],
    ['adv', '부사형', '~게', 'n5'],
    ['polneg', '정중 부정', '~지 않습니다', 'n5'],
    ['polpast', '정중 과거', '~었습니다', 'n5'],
    ['attr', '명사 수식', '~한 (명사)', 'n5'],
    ['naru', '~해지다', '~해지다 / ~게 되다', 'n4'],
    ['ba', '가정형', '~하면', 'n4'],
    ['tara', 'たら 가정', '~하면 / ~했더니', 'n4'],
    ['sou', '양태 そう', '~해 보인다', 'n4'],
    ['sa', '명사형 さ', '~함 (정도)', 'n3'],
  ];
  const AFORM = Object.fromEntries(AFORMS.map((f) => [f[0], { key: f[0], name: f[1], ko: f[2], lv: f[3] }]));
  const ARULES = {
    neg: ['い → くない (いい → よくない)', '+ じゃない (= ではない)', ['この 料理[りょうり]は 辛[から]くない。', '이 요리는 맵지 않다.']],
    past: ['い → かった (いい → よかった)', '+ だった', ['昨日[きのう]は 寒[さむ]かった。', '어제는 추웠다.']],
    pastneg: ['い → くなかった', '+ じゃなかった', ['テストは 難[むずか]しくなかった。', '시험은 어렵지 않았다.']],
    te: ['い → くて (安くて おいしい)', '+ で (静かで きれい)', ['この 部屋[へや]は 広[ひろ]くて 明[あか]るいです。', '이 방은 넓고 밝아요.']],
    adv: ['い → く (早く 起きる)', '+ に (静かに 話す)', ['もう 少[すこ]し 静[しず]かに 話[はな]して ください。', '조금 더 조용히 말해 주세요.']],
    polneg: ['い → くないです / くありません', '+ じゃありません / じゃないです', ['今日[きょう]は 忙[いそが]しくないです。', '오늘은 바쁘지 않아요.']],
    polpast: ['い → かったです (✕ 高いでした)', '+ でした', ['旅行[りょこう]は 楽[たの]しかったです。', '여행은 즐거웠어요.']],
    attr: ['그대로 + 명사 (高い 山)', '+ な + 명사 (静かな 町)', ['静[しず]かな 町[まち]に 住[す]みたいです。', '조용한 동네에 살고 싶어요.']],
    naru: ['い → くなる', '+ になる', ['日本語[にほんご]が 上手[じょうず]に なりました。', '일본어가 능숙해졌어요.']],
    ba: ['い → ければ (安ければ)', '+ なら (暇なら)', ['安[やす]ければ 買[か]います。', '싸면 살게요.']],
    tara: ['い → かったら', '+ だったら', ['暇[ひま]だったら 遊[あそ]びに 来[き]て ください。', '한가하면 놀러 오세요.']],
    sou: ['い를 떼고 + そう (いい → よさそう, ない → なさそう)', '+ そう', ['この ケーキ、おいしそうですね。', '이 케이크 맛있어 보이네요.']],
    sa: ['い → さ (高さ, 長さ)', '—', ['この 川[かわ]の 深[ふか]さは 二[に]メートルです。', '이 강의 깊이는 2미터입니다.']],
  };

  function adjForm(a, f) {
    if (!AFORM[f]) return null;
    if (a.t === 'na') {
      const T = { neg: 'じゃない', past: 'だった', pastneg: 'じゃなかった', te: 'で', adv: 'に', polneg: 'じゃありません', polpast: 'でした', attr: 'な', naru: 'になる', ba: 'なら', tara: 'だったら', sou: 'そう' }[f];
      return T == null ? null : { w: a.w + T, r: a.r + T };
    }
    if (f === 'attr') return null;
    let K = a.w.slice(0, -1), R = a.r.slice(0, -1);
    if (a.r.endsWith('いい')) { K = a.w.slice(0, -2) + 'よ'; R = a.r.slice(0, -2) + 'よ'; }
    const T = { neg: 'くない', past: 'かった', pastneg: 'くなかった', te: 'くて', adv: 'く', polneg: 'くないです', polpast: 'かったです', naru: 'くなる', ba: 'ければ', tara: 'かったら', sou: a.r.endsWith('ない') ? 'さそう' : 'そう', sa: 'さ' }[f];
    if (T == null) return null;
    if (f === 'sou' && a.r.endsWith('いい')) return { w: K + 'さそう', r: R + 'さそう' };
    return { w: K + T, r: R + T };
  }
  function adjAlts(a, f) {
    const alt = [];
    if (a.t === 'i' && f === 'polneg') { const x = adjForm(a, 'neg'); alt.push({ w: x.w.slice(0, -2) + 'ありません', r: x.r.slice(0, -2) + 'ありません' }); }
    if (a.t === 'na' && f === 'neg') alt.push({ w: a.w + 'ではない', r: a.r + 'ではない' });
    if (a.t === 'na' && f === 'polneg') alt.push({ w: a.w + 'じゃないです', r: a.r + 'じゃないです' }, { w: a.w + 'ではありません', r: a.r + 'ではありません' });
    return alt;
  }
  function adjWrongs(a, f) {
    const right = adjForm(a, f);
    if (!right) return [];
    const out = [];
    const push = (x) => { if (x && x.r !== right.r && !out.some((y) => y.r === x.r)) out.push(x); };
    if (a.t === 'i') {
      // な형용사처럼 활용하는 실수
      push(adjForm(Object.assign({}, a, { t: 'na' }), f));
      if (f === 'polpast') { push({ w: a.w + 'でした', r: a.r + 'でした' }); push({ w: a.w.slice(0, -1) + 'くなかったです', r: a.r.slice(0, -1) + 'くなかったです' }); }
      if (a.r.endsWith('いい')) { // いい → いく… 실수
        const K = a.w.slice(0, -1), R = a.r.slice(0, -1);
        const T = { neg: 'くない', past: 'かった', pastneg: 'くなかった', te: 'くて', adv: 'く', polneg: 'くないです', polpast: 'かったです', naru: 'くなる', ba: 'ければ', tara: 'かったら', sou: 'そう', sa: 'さ' }[f];
        if (T) push({ w: K + T, r: R + T });
      }
      if (f === 'te') push({ w: a.w + 'て', r: a.r + 'て' });
      if (f === 'sou') push({ w: a.w + 'そう', r: a.r + 'そう' });
    } else {
      // い형용사처럼 활용하는 실수 (きれい·嫌い는 특히 주의)
      const endsI = a.r.endsWith('い');
      const fake = { w: endsI ? a.w : a.w + 'い', r: endsI ? a.r : a.r + 'い', t: 'i', m: a.m };
      push(adjForm(fake, f === 'attr' ? 'adv' : f));
      if (f === 'attr') push({ w: a.w + 'の', r: a.r + 'の' });
      if (f === 'polpast') push({ w: a.w + 'だったでした', r: a.r + 'だったでした' });
      if (f === 'te') push({ w: a.w + 'くて', r: a.r + 'くて' });
    }
    const NEAR = { neg: ['pastneg', 'polneg', 'past'], past: ['pastneg', 'polpast', 'neg'], pastneg: ['neg', 'past', 'polneg'], te: ['adv', 'ba', 'naru'], adv: ['te', 'naru', 'attr'], polneg: ['neg', 'polpast', 'pastneg'], polpast: ['past', 'polneg', 'pastneg'], attr: ['adv', 'te', 'sou'], naru: ['adv', 'te', 'past'], ba: ['tara', 'te', 'past'], tara: ['ba', 'past', 'te'], sou: ['sa', 'adv', 'te'], sa: ['sou', 'adv', 'neg'] }[f] || [];
    for (const n of NEAR) push(adjForm(a, n));
    const alts = adjAlts(a, f);
    return out.filter((x) => !alts.some((y) => y.r === x.r));
  }

  /* ───────── 표시 ───────── */
  const markup = (x) => jp.align(x.w, x.r);
  // 来る는 한자가 같아 후리가나를 끄면 구별이 안 되므로 가나로 표시
  const disp = (v, x) => `<span class="jp" lang="ja">${v && v.kuru ? util.esc(x.r) : jp.ruby(markup(x))}</span>`;
  const lvIdx = (lv) => LV.indexOf(lv);

  function pool(kind, lv) {
    const max = lv === 'all' ? 9 : lvIdx(lv);
    const list = kind === 'adj' ? adjs : verbs;
    const p = list.filter((x) => lvIdx(x.lv) <= Math.max(0, max));
    return p.length ? p : list;
  }

  /* ───────── 문제 생성 ───────── */
  function exPick(v, f, isAdj) {
    const right = isAdj ? adjForm(v, f) : verbForm(v, f);
    if (!right) return null;
    const wr = util.shuffle(isAdj ? adjWrongs(v, f) : verbWrongs(v, f)).slice(0, 3);
    if (wr.length < 3) return null;
    const info = (isAdj ? AFORM : FORM)[f];
    const rule = isAdj ? ARULES[f][v.t === 'i' ? 0 : 1] : RULES[f][v.g - 1];
    const opts = util.shuffle([right, ...wr]).map((x) => ({ html: disp(isAdj ? null : v, x), val: x.r, tts: x.r }));
    return {
      kind: 'choice', title: '알맞은 활용형을 고르세요', tts: right.r,
      q: { html: `${disp(isAdj ? null : v, v)}<div class="conj-ask">→ <b>${util.esc(info.name)}</b> <small>${util.esc(info.ko)}</small></div>`, big: true, sub: util.esc(v.m) + (isAdj ? (v.t === 'i' ? ' · い형용사' : ' · な형용사') : ' · ' + groupOf(v)) },
      opts, ans: right.r, cols: 1,
      explain: `${disp(isAdj ? null : v, v)} → ${disp(isAdj ? null : v, right)}<br><small>📐 ${jp.rubyRaw(rule)}</small>`,
      conj: { id: v.id, f },
    };
  }

  function exIdentify(v, f, isAdj) {
    const right = isAdj ? adjForm(v, f) : verbForm(v, f);
    if (!right) return null;
    const F = isAdj ? AFORMS : FORMS;
    const fn = isAdj ? adjForm : verbForm;
    // 같은 모양이 되는 다른 형태(수동=가능 등)는 보기에서 제외
    const cand = F.map((x) => x[0]).filter((k) => k !== f && (() => { const y = fn(v, k); return y && y.r !== right.r; })());
    const ds = util.sample(cand, 3);
    if (ds.length < 3) return null;
    const M = isAdj ? AFORM : FORM;
    return {
      kind: 'choice', title: '어떤 활용형인가요?', tts: right.r,
      q: { html: disp(isAdj ? null : v, right), big: true, sub: `기본형: <span lang="ja">${util.esc(v.w)}</span> (${util.esc(v.m)})`, audio: right.r },
      opts: util.shuffle([f, ...ds]).map((k) => ({ html: `<b>${util.esc(M[k].name)}</b> <small class="muted">${util.esc(M[k].ko)}</small>`, val: k })),
      ans: f, cols: 1,
      explain: `${disp(isAdj ? null : v, right)} = <b>${util.esc(M[f].name)}</b> (${util.esc(M[f].ko)})`,
    };
  }

  // 활용형 → 사전형 (て·た형 음편 역추적)
  function exDict(v, f) {
    if (v.g !== 1 || !['te', 'ta'].includes(f) || !jp.hasKanji(v.w)) return null;
    const right = verbForm(v, f);
    if (!right) return null;
    const stem = v.w.slice(0, -1);
    const groups = [['う', 'つ', 'る'], ['む', 'ぶ', 'ぬ'], ['く', 'ぐ'], ['す']];
    const u = v.r.slice(-1);
    const same = v.r === 'いく' ? ['う', 'つ', 'る'] : (groups.find((g) => g.includes(u)) || []).filter((x) => x !== u);
    const other = 'うつるむぶぬくぐす'.split('').filter((x) => x !== u && !same.includes(x));
    const cand = util.uniq(same.concat(util.shuffle(other))).slice(0, 3);
    return {
      kind: 'choice', title: '사전형(기본형)은 무엇일까요?', tts: right.r,
      q: { html: disp(v, right), big: true, audio: right.r },
      opts: util.shuffle([u, ...cand]).map((x) => ({ html: `<span class="jp" lang="ja">${util.esc(stem + x)}</span>`, val: x })),
      ans: u, cols: 2,
      explain: `${disp(v, right)} ← <b lang="ja">${jp.ruby(markup(v))}</b> (${util.esc(v.m)})<br><small>📐 ${jp.rubyRaw(RULES.te[0])}</small>`,
    };
  }

  // 활용형 조립 (어간 + 가나 조각)
  function exBuild(v, f, isAdj) {
    if (!isAdj && v.kuru) return null;
    const right = isAdj ? adjForm(v, f) : verbForm(v, f);
    if (!right) return null;
    let k = 0;
    while (k < v.w.length && k < right.w.length && v.w[k] === right.w[k]) k++;
    // 어간은 한자/어근 부분까지만 (변화하는 가나 조각부터 쪼개기)
    while (k > 0 && !jp.hasKanji(v.w.slice(0, k)) && k > 0) k--;
    if (k === 0) k = Math.min(v.w.length - 1, right.w.length - 1);
    const suffix = right.w.slice(k);
    if (!suffix || suffix.length > 8) return null;
    const prefixR = right.r.slice(0, right.r.length - suffix.length);
    const head = jp.align(right.w.slice(0, k), prefixR);
    const chars = [...suffix];
    const ans = [head, ...chars];
    const used = new Set(chars);
    const extra = [];
    for (const x of util.shuffle(isAdj ? adjWrongs(v, f) : verbWrongs(v, f))) {
      for (const c of x.w.slice(k)) if (!used.has(c) && !/[㐀-鿿]/.test(c)) { used.add(c); extra.push(c); }
      if (extra.length >= 3) break;
    }
    const info = (isAdj ? AFORM : FORM)[f];
    return {
      kind: 'build', lang: 'ja', title: '활용형을 만들어 보세요', tts: right.r,
      q: { html: `${disp(isAdj ? null : v, v)}<div class="conj-ask">→ <b>${util.esc(info.name)}</b> <small>${util.esc(info.ko)}</small></div>`, big: true },
      tiles: util.shuffle(ans.concat(extra.slice(0, 3))).map((c) => ({ html: jp.ruby(c), val: c })),
      ans,
      explain: `${disp(isAdj ? null : v, v)} → ${disp(isAdj ? null : v, right)}`,
    };
  }

  function exListen(v, f, isAdj) {
    if (!App.ex.canListen()) return null;
    const fn = isAdj ? adjForm : verbForm;
    const right = fn(v, f);
    if (!right) return null;
    const F = (isAdj ? AFORMS : FORMS).map((x) => x[0]).filter((k) => k !== f);
    const others = util.uniq(util.shuffle(F).map((k) => fn(v, k)).filter((x) => x && x.r !== right.r), (x) => x.r).slice(0, 3);
    if (others.length < 3) return null;
    const M = isAdj ? AFORM : FORM;
    return {
      kind: 'choice', title: '들리는 활용형을 고르세요', tts: right.r, listen: true,
      q: { audio: right.r, hideText: true },
      opts: util.shuffle([right, ...others]).map((x) => ({ html: disp(isAdj ? null : v, x), val: x.r })),
      ans: right.r, cols: 1,
      explain: `${disp(isAdj ? null : v, right)} — <b>${util.esc(M[f].name)}</b> (${util.esc(v.m)})`,
    };
  }

  function exGroup(v) {
    const opts = [['1', '1그룹 (5단)'], ['2', '2그룹 (1단)'], ['3', '3그룹 (불규칙)']];
    const masu = verbForm(v, 'masu') || verbForm(v, 'te');
    return {
      kind: 'choice', title: '몇 그룹 동사인가요?', tts: v.r, fewOk: true,
      q: { html: disp(v, v), big: true, sub: util.esc(v.m), audio: v.r },
      opts: opts.map(([val, html]) => ({ html, val })), ans: String(v.g), cols: 1,
      explain: `${disp(v, v)} — <b>${groupOf(v)}</b><br>${groupWhy(v)}${masu ? `<br><small>예: ${disp(v, masu)}</small>` : ''}`,
    };
  }

  function exAdjType(a) {
    return {
      kind: 'choice', title: 'い형용사일까요, な형용사일까요?', tts: a.r, fewOk: true,
      q: { html: `<span class="jp" lang="ja">${jp.ruby(markup(a))}</span>`, big: true, sub: util.esc(a.m) },
      opts: [{ html: 'い형용사 (〜くない)', val: 'i' }, { html: 'な형용사 (〜じゃない)', val: 'na' }], ans: a.t, cols: 1,
      explain: `<b lang="ja">${util.esc(a.w)}</b>: ${a.t === 'i' ? 'い형용사' : 'な형용사'} → <span lang="ja">${jp.ruby(markup(adjForm(a, 'neg')))}</span>` + (a.t === 'na' && a.r.endsWith('い') ? '<br>⚠️ い로 끝나지만 な형용사예요!' : ''),
    };
  }

  // 레슨 구성: opts = { kind:'verb'|'adj', forms:[], lv, n }
  function drill({ kind = 'verb', forms, lv = 'n5', n = 15, only = '' } = {}) {
    const isAdj = kind === 'adj';
    const P = pool(kind, lv);
    const list = [];
    if (only === 'group') {
      for (const v of util.sample(P, n)) list.push(exGroup(v));
      return list;
    }
    if (only === 'type') {
      const tricky = adjs.filter((a) => a.t === 'na' && a.r.endsWith('い'));
      for (const a of util.shuffle(util.sample(P, n - 2).concat(util.sample(tricky, 2)))) list.push(exAdjType(a));
      return util.uniq(list, (e) => e.tts).slice(0, n);
    }
    const F = (forms && forms.length ? forms : (isAdj ? AFORMS : FORMS).filter((f) => lvIdx(f[3]) <= Math.max(0, lvIdx(lv === 'all' ? 'n3' : lv))).map((f) => f[0]));
    const makers = isAdj
      ? [['pick', 5], ['build', 2], ['id', 2], ['listen', 1], ['type', 1]]
      : [['pick', 5], ['build', 2], ['id', 2], ['listen', 1], ['dict', 1], ['group', 1]];
    const bag = makers.flatMap(([k, w]) => Array(w).fill(k));
    let guard = 0;
    const seen = new Set();
    while (list.length < n && guard++ < n * 30) {
      const v = util.pick(P);
      const f = util.pick(F);
      const t = util.pick(bag);
      const key = v.id + f + t;
      if (seen.has(key)) continue;
      let e = null;
      if (t === 'pick') e = exPick(v, f, isAdj);
      else if (t === 'build') e = exBuild(v, f, isAdj);
      else if (t === 'id') e = exIdentify(v, f, isAdj);
      else if (t === 'listen') e = exListen(v, f, isAdj);
      else if (t === 'dict') e = exDict(v, util.pick(['te', 'ta']));
      else if (t === 'group') e = exGroup(v);
      else if (t === 'type') e = exAdjType(v);
      if (e) { seen.add(key); list.push(e); }
    }
    return list;
  }

  return {
    verbs, adjs, FORMS, FORM, RULES, AFORMS, AFORM, ARULES,
    verbForm, adjForm, verbWrongs, adjWrongs, verbAlts, adjAlts, groupOf, groupWhy, markup, disp, pool, drill,
    exPick, exIdentify, exDict, exBuild, exListen, exGroup, exAdjType,
  };
})();
