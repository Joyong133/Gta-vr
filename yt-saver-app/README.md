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
- 오류 창의 "자세한 오류"에 예외 종류와 유튜브가 준 사유가 나오고 **오류 복사**로 복사 가능.

## 주의
개인 소장·오프라인 시청 용도로만 쓰세요. 유튜브 약관상 다운로드는 허용되지 않으며,
다른 사람의 영상을 재배포하면 저작권 침해가 될 수 있습니다.
