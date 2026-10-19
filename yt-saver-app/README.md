# 튜브 보관함 (안드로이드)

유튜브 링크를 넣으면 영상을 휴대폰에 저장하고, 저장한 영상을 인터넷 없이 재생하는 개인용 앱입니다.
앱을 최소화하거나 화면을 꺼도 소리는 계속 나옵니다.

## 설치
`yt-saver-app/` 이 바뀐 커밋이 push 되면 GitHub Actions(`Tube Box APK`)가 APK를 빌드해
`tube-box-v1.0.N` 릴리스에 `tube-box.apk` 로 올립니다. 휴대폰에서 받아 설치하면 됩니다.

## 사용법
- 유튜브 앱에서 영상 **공유 → 튜브 보관함** 을 누르면 바로 저장이 시작됩니다.
- 또는 앱에서 링크를 붙여넣고 화질을 고른 뒤 **저장하기**.
- 목록에서 영상을 누르면 재생, 길게 누르면 삭제.
- 재생 중 홈 버튼/뒤로가기/화면 끄기 → 소리는 계속, 알림창에서 일시정지·다음 곡 조작.
- **시청 기록**: 영상마다 본 위치를 기억해 다시 누르면 이어서 재생. 목록에 진행 막대와
  "이어보기 / 다 봄"을 표시하고, "최근 본" 정렬을 지원. 앱이 완전히 꺼져도 다시 열면
  마지막으로 보던 영상이 그 위치에 일시정지 상태로 준비됨.
- **구글 번역 (무료, 기본)**: 한국어 자막이 없으면 `GoogleTranslator.kt`가 구글 번역 웹 엔드포인트
  (`translate.googleapis.com/translate_a/single?client=gtx`, 키 불필요)로 번역한다. 자동 생성 자막은 문장 단위로
  합쳐서 번역(줄 단위보다 자연스러움), 여러 줄을 줄바꿈으로 묶어 한 번에 보내고 줄 수가 어긋나면 한 줄씩 다시.
  순서: Claude(키를 넣고 켠 경우만) → 구글 번역 → 유튜브 자동 번역 → ML Kit. 공식 유료 API가 아니라 많이 쓰면
  잠시 막힐 수 있음. 길게 눌러 "구글 번역으로 한국어 자막 다시 만들기"는 저장된 원어 자막으로 다시 번역(유튜브 접속 없음).
- **AI 자막 번역 (Claude, 유료·선택, 기본 꺼짐)**: 메뉴 → "AI 자막 번역 설정"에서 Claude API 키와 모델(Opus 5.5 / Sonnet 5.5 /
  Haiku 5.5)을 넣으면, 한국어 자막이 없는 영상은 Claude가 120줄씩 앞뒤 문맥을 보고 번역한다
  (공식 `anthropic-java` SDK, structured output으로 `{i, t}` 목록을 받아 줄 번호대로 맞춤, Opus·Sonnet은
  서버 측 거절 폴백 `fallbacks: "default"`). 실패하면 유튜브 자동 번역 → ML Kit 순서로 넘어간다.
  이미 저장한 영상은 길게 눌러 "AI(Claude)로 한국어 자막 다시 번역" → 저장된 `sub_orig.vtt`를 다시 번역하므로
  유튜브 접속이 필요 없다. 키는 앱 전용 SharedPreferences에만 보관.
- **집중 모드**: 메뉴 → "🎯 집중 모드". 켜면 아직 안 본 앞부분으로 이동할 수 없고 이미 본 곳까지만 이동된다.
  `PlaybackService`가 1초마다 이어서 재생한 가장 먼 위치(`m_<id>`)를 기록하고(3초 넘게 건너뛴 위치는 인정 안 함),
  세션 플레이어를 `FocusModePlayer`(ForwardingPlayer)로 감싸 화면·알림·블루투스의 모든 이동 명령을 그 위치로 제한.
  빨리 감기 버튼은 숨기고, 영상을 다 보기 전에는 다음 영상으로 넘어가기도 막는다.
- **소리 언어 선택**: 저장 카드의 "소리 언어" → 원래 언어(기본)/한국어/영어/일본어 등. 유튜브에 그 언어 더빙 소리가
  있으면 그 소리로 저장(화면만 있는 영상 + 그 소리 파일), 없으면 원래 언어로 저장하고 알려 준다.
- **잠금화면에서 바로 보기** (메뉴, 기본 켜짐): 재생 중이면 `setShowWhenLocked(true)`로 화면을 다시 켰을 때
  잠금 해제 없이 앱 화면이 먼저 나온다. 잠금 상태(`KeyguardManager.isKeyguardLocked`)에서는 플레이어·목록만 쓰고
  저장 카드·메뉴·길게 누르기 메뉴는 숨긴다. 잠금을 풀면(`ACTION_USER_PRESENT`) 원래대로.
- **배경 소리**: 목록에서 길게 눌러 "배경 소리로 같이 듣기" → 지금 보는 영상은 그대로 두고 그 항목의 소리만
  동시에 재생(예: 강의 영상 + 음악). 화면 위 막대에서 재생/일시정지, 한 곡 반복, 배경·영상 소리 크기 따로 조절.
  서비스 안의 두 번째 ExoPlayer/MediaSession(오디오 포커스 안 잡음, 영상·자막 트랙 끔)이라 앱을 내려도 계속 나온다.
- **한국어 자막**: 저장할 때 "한국어 자막 같이 저장"을 켜 두면 한국어 자막이 있으면 그대로,
  없으면 유튜브 자동 번역(tlang=ko)으로, 그것도 막히면 ML Kit으로 기기 안에서 번역해
  `sub_ko.vtt`로 저장. 원어 자막은 `sub_orig.vtt`. 플레이어의 CC 버튼으로 켜고 끔.
  이미 저장한 영상은 길게 눌러 "한국어 자막 받기".

## 구조
| 파일 | 역할 |
| --- | --- |
| `VideoSource.kt` | 영상 정보 가져오기. 기본은 NewPipeExtractor, 막히면 TV/VR 클라이언트로 직접 요청 |
| `YouTubeSaver.kt` | 스트림을 찾고 화질에 맞는 영상·소리 파일을 구간 단위로 내려받음 |
| `DownloadService.kt` | 앱을 내려도 저장이 계속되도록 포그라운드 서비스에서 대기열 처리 |
| `Library.kt` | `Android/data/com.joyong.ytsaver/files/videos/<영상ID>/` 에 파일과 `meta.json` 보관 |
| `SubtitleSaver.kt` | 유튜브 자막(json3)을 받아 한국어로 번역해 WebVTT로 저장 |
| `ClaudeTranslator.kt` | Claude API로 자막 큐를 묶어서 한국어로 번역, AI 설정 보관 |
| `WatchHistory.kt` | 영상별 시청 위치와 마지막 재생목록 저장 |
| `PlaybackService.kt` | Media3 `MediaSessionService` + ExoPlayer. 영상/소리/자막 파일을 합쳐 재생, 백그라운드 재생, 시청 위치 저장 |
| `MainActivity.kt` | 입력·진행률·보관함 목록·플레이어 화면 |

화면이 꺼지면 영상 트랙 디코딩을 끄고 소리만 재생해서 배터리를 아낍니다.

## 유튜브 추출 라이브러리
[NewPipeExtractor](https://github.com/TeamNewPipe/NewPipeExtractor) v0.26.5(GPL-3.0)와 nanojson을
소스에서 빌드한 jar를 `android/app/libs/` 에 넣어 두었습니다(JitPack 없이 빌드되도록).
유튜브가 구조를 바꿔 저장이 안 되기 시작하면 새 버전으로 jar를 교체해야 합니다.

## 유튜브가 막을 때
- **reCAPTCHA(HTTP 429)**: 오류 창의 **로봇 확인하기** → 앱 안에서 유튜브 확인 페이지를 풀면
  구글이 주는 `GOOGLE_ABUSE_EXEMPTION` 쿠키를 저장해 이후 요청에 붙이고, 실패한 저장을 다시 시도.
  (NewPipe와 같은 방식)
- **Sign in to confirm you're not a bot**: NewPipeExtractor는 VisionOS 클라이언트로만 요청하는데,
  유튜브는 클라이언트마다 다르게 막는다. 그래서 이 경우 `VideoSource.kt`가 yt-dlp의 클라이언트 설정을
  참고해 **TV(삼성 TVHTML5)** → **퍼가기 플레이어(WEB_EMBEDDED_PLAYER)** → **Oculus VR(ANDROID_VR)** 순서로 `/youtubei/v1/player`에 직접 요청한다.
  TV 클라이언트의 서명/n 파라미터는 NewPipeExtractor의 `YoutubeJavaScriptPlayerManager`로 푼다.
  모두 막히면 와이파이↔데이터 전환, VPN 끄기, 시간 두고 재시도. 자세한 오류에 각 클라이언트 결과(`+ ...`)가 나온다.
- **유튜브 로그인**: 위 방식이 모두 `LOGIN_REQUIRED`로 막히면(IP 차단) 오른쪽 위 **유튜브 로그인**으로
  구글 계정에 로그인. 비밀번호는 저장하지 않고 로그인 후 youtube.com 쿠키만 앱 저장소에 보관하고,
  TV·퍼가기 클라이언트 요청에 쿠키와 `SAPISIDHASH` 인증 헤더(yt-dlp와 같은 방식)를 붙인다.
  다운로드용 계정은 구글이 제한할 수 있어 부계정 권장. 구글이 웹뷰 로그인을 막으면 사용할 수 없음.
- 오류 창의 "자세한 오류"에 예외 종류와 유튜브가 준 사유가 나오고 **오류 복사**로 복사 가능.

## 주의
개인 소장·오프라인 시청 용도로만 쓰세요. 유튜브 약관상 다운로드는 허용되지 않으며,
다른 사람의 영상을 재배포하면 저작권 침해가 될 수 있습니다.
