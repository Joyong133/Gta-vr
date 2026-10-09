/* 설정, 첫 실행 안내(온보딩), 앱 정보 */
'use strict';

(function () {
  const { h, util } = App;
  const S = () => App.store.state;

  function toggleRow(label, desc, key, onChange) {
    const st = S().settings;
    const input = h('input', { type: 'checkbox' });
    input.checked = !!st[key];
    input.addEventListener('change', () => { st[key] = input.checked; App.store.save(); if (onChange) onChange(input.checked); });
    return h('label.set-row', h('div.sr-b', h('div.sr-t', label), desc ? h('div.sr-d', desc) : null), h('span.switch', input, h('i')));
  }
  function segRow(label, options, value, onPick) {
    const seg = h('div.seg');
    for (const [v, l] of options) seg.appendChild(h('button.seg-btn' + (String(v) === String(value) ? '.on' : ''), { type: 'button', onclick: () => { onPick(v); App.store.save(); App.rerender(); } }, l));
    return h('div.set-block', h('div.sr-t', label), seg);
  }

  App.screens.settings = function () {
    const st = S();
    const el = h('div.pad');
    // 프로필
    const name = h('input.text', { type: 'text', value: st.profile.name, maxlength: 16 });
    name.addEventListener('change', () => { st.profile.name = name.value.trim() || '학습자'; App.store.save(); });
    const exam = h('input.text', { type: 'date', value: st.profile.examDate || '' });
    exam.addEventListener('change', () => { st.profile.examDate = exam.value; App.store.save(); });
    el.append(h('div.section-title', '프로필'),
      h('div.set-block', h('div.sr-t', '이름'), h('div.row.gap', h('button.btn.ghost', { type: 'button', onclick: () => App.pickAvatar() }, st.profile.avatar), name)),
      segRow('목표 레벨', [['n5', 'N5'], ['n4', 'N4'], ['n3', 'N3'], ['n2', 'N2'], ['n1', 'N1']], st.profile.target, (v) => { st.profile.target = v; }),
      h('div.set-block', h('div.sr-t', 'JLPT 시험일 (D-day 표시)'), exam),
      segRow('하루 목표 XP', [[10, '가볍게 10'], [30, '보통 30'], [50, '진지 50'], [100, '열정 100']], st.profile.goalXp, (v) => { st.profile.goalXp = v; }));

    // 학습
    el.append(h('div.section-title', '학습'),
      toggleRow('후리가나 표시', '한자 위에 읽는 법을 작게 표시해요', 'furigana', () => App.applyTheme()),
      toggleRow('자동 발음 재생', '문제·카드가 나오면 자동으로 읽어 줘요', 'autoplay'),
      toggleRow('듣기 문제', '소리로 듣고 푸는 문제 출제', 'listen'),
      toggleRow('말하기 문제', '마이크로 발음 연습 (음성 인식 지원 기기)', 'speak'),
      toggleRow('하트 시스템', '챌린지에서 틀리면 하트 감소 (끄면 무제한)', 'hearts'),
      segRow('발음 속도', [[0.6, '느리게'], [0.8, '조금 느리게'], [0.9, '보통'], [1.1, '빠르게']], st.settings.ttsRate, (v) => { st.settings.ttsRate = v; App.tts.speak('こんにちは、日本語を勉強しましょう'); }),
      segRow('복습 1회 카드 수', [[10, '10'], [20, '20'], [40, '40'], [80, '80']], st.settings.reviewBatch, (v) => { st.settings.reviewBatch = v; }));
    if (App.native.available) {
      el.append(h('button.btn.ghost.block', { type: 'button', onclick: () => App.native.call('openTtsSettings') }, '🔧 일본어 음성(TTS) 엔진 설정 열기'));
      el.append(h('p.small.muted', '발음이 나오지 않으면 Google 음성 서비스에서 "일본어" 음성 데이터를 설치해 주세요.'));
    }
    el.append(h('button.btn.ghost.block', { type: 'button', onclick: () => App.tts.speak('日本語の発音テストです') }, '🔊 발음 테스트'));

    // 화면/소리
    el.append(h('div.section-title', '화면 · 소리'),
      segRow('테마', [['auto', '시스템'], ['light', '라이트'], ['dark', '다크']], st.settings.theme, (v) => { st.settings.theme = v; App.applyTheme(); }),
      toggleRow('효과음', '정답·오답 소리', 'sound'),
      toggleRow('진동', '정답·오답 진동', 'haptic'));

    // 알림
    if (App.native.available) {
      const time = h('input.text', { type: 'time', value: st.settings.reminder || '' });
      const save = () => {
        st.settings.reminder = time.value;
        App.store.save();
        if (time.value) {
          const [hh, mm] = time.value.split(':').map(Number);
          App.native.call('setReminder', hh, mm);
          App.ui.toast(`매일 ${time.value}에 학습 알림을 보내 드릴게요`);
        } else { App.native.call('cancelReminder'); App.ui.toast('학습 알림을 껐어요'); }
      };
      time.addEventListener('change', save);
      el.append(h('div.section-title', '학습 알림'),
        h('div.set-block', h('div.sr-t', '매일 알림 시간'), h('div.row.gap', time, h('button.btn.ghost', { type: 'button', onclick: () => { time.value = ''; save(); } }, '끄기'))));
    }

    // 데이터
    el.append(h('div.section-title', '데이터'),
      h('p.small.muted', '학습 기록은 기기 안에만 저장돼요. 휴대폰을 바꾸기 전에 백업하세요.'),
      h('div.row.gap.wrap',
        h('button.btn.ghost.grow', { type: 'button', onclick: backup }, '📤 백업 내보내기'),
        h('button.btn.ghost.grow', { type: 'button', onclick: restore }, '📥 백업 불러오기')),
      h('button.btn.danger.block', { type: 'button', onclick: () => App.ui.confirm('모든 학습 기록을 지우고 처음부터 시작할까요? 되돌릴 수 없어요.', { danger: true, ok: '초기화' }).then((ok) => { if (ok) { App.store.reset(); App.go('onboard', true); } }) }, '🗑️ 학습 기록 초기화'));
    return { el, title: '설정', back: true, tab: 'more' };
  };

  function backup() {
    App.store.flush();
    const json = JSON.stringify(App.store.state);
    if (App.native.available) { App.native.call('saveBackupFile', `nihongo-master-backup-${util.dayKey()}.json`, json); return; }
    App.ui.sheet((body) => {
      const ta = h('textarea.backup', { readonly: true }, json);
      body.append(h('p.small', '아래 내용을 복사해 안전한 곳에 보관하세요.'), ta,
        h('button.btn.primary.block', { type: 'button', onclick: () => { ta.select(); try { navigator.clipboard.writeText(json); App.ui.toast('복사했어요'); } catch (e) { document.execCommand('copy'); } } }, '복사하기'));
    }, { title: '백업 내보내기' });
  }
  App.importBackup = function (text) {
    try { App.store.importJson(String(text || '').trim()); App.applyTheme(); App.ui.toast('백업을 불러왔어요!'); App.go('home'); }
    catch (e) { App.ui.toast('불러오기 실패: ' + e.message, 3000); }
  };
  function restore() {
    if (App.native.available) {
      App.ui.confirm('백업 파일(.json)을 선택하면 현재 기록을 덮어써요. 계속할까요?', { ok: '파일 선택' }).then((ok) => { if (ok) App.native.call('openBackupFile'); });
      return;
    }
    App.ui.sheet((body, close) => {
      const ta = h('textarea.backup', { placeholder: '백업한 내용을 여기에 붙여넣으세요' });
      body.append(ta, h('button.btn.primary.block', { type: 'button', onclick: () => {
        try { App.store.importJson(ta.value.trim()); close(); App.applyTheme(); App.ui.toast('백업을 불러왔어요!'); App.go('home'); }
        catch (e) { App.ui.toast('불러오기 실패: ' + e.message, 3000); }
      } }, '불러오기'));
    }, { title: '백업 불러오기' });
  }

  /* ───────── 온보딩 ───────── */
  App.screens.onboard = function () {
    const st = S();
    const el = h('div.onboard');
    let step = 0;
    const pick = { name: '', start: 'kana', goal: 30, target: 'n3' };
    const steps = [
      () => [
        h('div.ob-hero', h('div.ob-logo', { lang: 'ja' }, '日本語'), h('div.ob-title', '일본어 마스터'), h('div.ob-sub', '문자부터 JLPT N1까지, 두 가지 과정으로')),
        h('div.ob-points',
          h('div', '📘 ', h('b', '체계 코스'), ' — 상세한 문법 강의·예문·단원 테스트'),
          h('div', '🎮 ', h('b', '챌린지 로드'), ' — 하트·XP·스트릭·리그의 게임식 레슨'),
          h('div', '🔁 ', h('b', 'SRS 복습'), ' — 잊을 때쯤 다시 보여주는 과학적 복습'),
          h('div', '📝 ', h('b', 'JLPT 모의고사'), ' · 🧘 집중 모드 · 🔊 원어민 발음')),
        h('button.btn.primary.block.big', { type: 'button', onclick: nextStep }, '시작하기'),
      ],
      () => {
        const input = h('input.text.big', { type: 'text', placeholder: '이름 또는 닉네임', maxlength: 16, value: pick.name });
        input.addEventListener('input', () => { pick.name = input.value; });
        setTimeout(() => input.focus(), 100);
        return [h('div.ob-q', '어떻게 불러 드릴까요?'), input, h('button.btn.primary.block.big', { type: 'button', onclick: nextStep }, '다음')];
      },
      () => [
        h('div.ob-q', '지금 일본어 실력은?'),
        h('div.ob-opts', [
          ['kana', '🌱 완전 처음이에요', '히라가나부터 시작'],
          ['n5', '🙂 히라가나는 읽어요', 'N5부터 시작'],
          ['n4', '😎 기초 문법은 알아요', 'N4부터 열기'],
          ['n3', '💪 중급이에요', 'N3부터 열기'],
          ['n2', '🔥 상급이에요', 'N2부터 열기'],
          ['n1', '👑 N1에 도전해요', 'N1까지 모두 열기'],
        ].map(([v, t, d]) => h('button.ob-opt' + (pick.start === v ? '.on' : ''), { type: 'button', onclick: () => { pick.start = v; pick.target = v === 'kana' ? 'n5' : v === 'n1' ? 'n1' : App.C.LEVEL_ORDER[Math.min(5, App.C.LEVEL_ORDER.indexOf(v) + 1)]; nextStep(); } }, h('b', t), h('small', d)))),
      ],
      () => [
        h('div.ob-q', '하루 목표를 정해요'),
        h('div.ob-opts', [[10, '☕ 가볍게', '하루 5분'], [30, '📗 보통', '하루 15분'], [50, '🔥 진지하게', '하루 25분'], [100, '🚀 열정적으로', '하루 50분']].map(([v, t, d]) =>
          h('button.ob-opt' + (pick.goal === v ? '.on' : ''), { type: 'button', onclick: () => { pick.goal = v; nextStep(); } }, h('b', `${t} · ${v} XP`), h('small', d)))),
      ],
      () => [
        h('div.ob-hero', h('div.ob-logo', '🎉'), h('div.ob-title', `준비 완료, ${pick.name || '학습자'}님!`),
          h('div.ob-sub', '매일 조금씩이 가장 빠른 길이에요. 스트릭 🔥을 이어가 보세요!')),
        h('div.ob-points',
          h('div', '💡 처음이라면: 체계 코스로 개념을 익히고 → 챌린지로 반복 훈련'),
          h('div', '🔊 발음이 안 나오면 설정 → TTS 엔진에서 일본어 음성을 설치하세요'),
          h('div', '🧘 집중이 안 될 땐 집중 모드(뽀모도로)를 켜 보세요')),
        h('button.btn.primary.block.big', { type: 'button', onclick: finish }, '학습 시작!'),
      ],
    ];
    function draw() {
      el.innerHTML = '';
      el.appendChild(h('div.ob-dots', steps.map((_, i) => h('i' + (i === step ? '.on' : '')))));
      el.append(...steps[step]());
    }
    function nextStep() { step = Math.min(steps.length - 1, step + 1); draw(); }
    function finish() {
      st.profile.name = pick.name.trim() || '학습자';
      st.profile.start = pick.start;
      st.profile.target = pick.target;
      st.profile.goalXp = pick.goal;
      st.onboarded = true;
      if (pick.start !== 'kana') st.lastUnit = (App.C.levelById[pick.start] || App.C.levels[1]).units[0].id;
      App.store.save();
      App.go('home', true);
    }
    draw();
    return { el, full: true };
  };

  /* ───────── 앱 정보 / 학습 가이드 ───────── */
  App.screens.about = function () {
    const el = h('div.pad.about');
    const c = App.C;
    el.innerHTML = `
      <div class="about-hero"><div class="ob-logo" lang="ja">日本語</div><b>일본어 마스터</b><div class="small muted">문자 → N5 → N4 → N3 → N2 → N1</div></div>
      <div class="stat-grid">
        <div class="stat"><div class="st-v">${c.levels.reduce((a, l) => a + l.units.length, 0)}</div><div class="st-l">단원</div></div>
        <div class="stat"><div class="st-v">${c.all.v.length}</div><div class="st-l">단어</div></div>
        <div class="stat"><div class="st-v">${c.all.k.length}</div><div class="st-l">한자</div></div>
        <div class="stat"><div class="st-v">${c.all.g.length}</div><div class="st-l">문법</div></div>
        <div class="stat"><div class="st-v">${c.all.s.length}</div><div class="st-l">예문·회화</div></div>
        <div class="stat"><div class="st-v">${c.all.a.length}</div><div class="st-l">가나</div></div>
      </div>
      <h3>📘 체계 코스 활용법</h3>
      <ol><li>단원의 <b>문법</b> 탭에서 접속 규칙과 설명을 읽고, 예문을 눌러 소리 내어 따라 읽어요.</li>
      <li><b>단어·한자</b> 탭에서 카드로 외우고, 한자는 한국 한자음(훈음)과 연결해요.</li>
      <li><b>회화·독해</b>로 실제 문맥 속 쓰임을 확인해요.</li>
      <li><b>단원 테스트</b> 80% 이상이면 통과! 학습 항목이 복습 카드로 자동 등록돼요.</li></ol>
      <h3>🎮 챌린지 로드 활용법</h3>
      <ul><li>5분짜리 레슨을 하나씩 깨며 길을 따라가요. 틀린 문제는 레슨 끝에 다시 나와요.</li>
      <li>하트 ❤️는 30분마다 1개씩 회복되고, 복습으로도 얻을 수 있어요.</li>
      <li>레슨마다 👑가 쌓여요. 유닛 보스 🏆로 실력을 확인하세요.</li>
      <li>이미 아는 레벨은 <b>건너뛰기 테스트</b>로 바로 열 수 있어요.</li></ul>
      <h3>🏋️ 트레이닝 센터 활용법</h3>
      <ul><li><b>동사·형용사 활용</b>: ${(window.JPDATA.verbs || []).length}개 동사 × 22가지 형태, ${(window.JPDATA.adjs || []).length}개 형용사 × 13가지 형태를 규칙표와 함께 연습해요.</li>
      <li><b>조사 마스터 · 헷갈리는 문법</b>: 조사 ${(window.JPDATA.particles || []).length}개의 용법과 비교 문법 ${(window.JPDATA.compare || []).length}세트를 표로 정리하고 바로 구별 문제를 풀어요.</li>
      <li><b>숫자·시간·날짜</b>: さんびゃく·ろっぴゃく 같은 음 변화와 조수사를 표로 익혀요.</li>
      <li><b>상황별 회화 · 청해</b>: 식당·쇼핑 등 ${(window.JPDATA.phrases || []).length}가지 상황 표현, 받아쓰기·쉐도잉·연속 듣기(라디오 모드)로 귀를 열어요.</li>
      <li><b>단어장 · 문법 색인</b>: 레벨 전체 단어를 가리기 모드로 셀프 테스트하고, 목록 그대로 퀴즈·카드로 돌릴 수 있어요.</li>
      <li><b>레벨 진단</b>: 5분 테스트로 나에게 맞는 시작 레벨을 찾아 바로 열어 줘요.</li></ul>
      <h3>🔁 매일의 루틴 추천</h3>
      <ol><li>홈의 <b>📋 오늘의 학습 플랜</b> 5가지를 위에서부터 차례로 (모두 끝내면 💎15)</li><li>SRS 복습 카드 먼저 (5~10분)</li><li>체계 코스로 새 문법 1~2개 (10분)</li><li>챌린지 레슨 2~3개로 반복 훈련 (10분)</li><li>트레이닝 1개 + 문장 10개 듣기 (10분)</li><li>주 1회 JLPT 모의고사로 점검</li></ol>
      <p class="small muted">발음은 기기의 TTS 엔진(Google 음성 서비스 권장)을 사용해요. 모든 학습 데이터는 기기에만 저장되며 인터넷 없이도 동작해요.</p>`;
    return { el, title: '앱 정보', back: true, tab: 'more' };
  };
})();
