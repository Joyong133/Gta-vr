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

## 구조
| 파일 | 역할 |
| --- | --- |
| `YouTubeSaver.kt` | NewPipeExtractor로 스트림을 찾고 화질에 맞는 영상·소리 파일을 구간 단위로 내려받음 |
| `DownloadService.kt` | 앱을 내려도 저장이 계속되도록 포그라운드 서비스에서 대기열 처리 |
| `Library.kt` | `Android/data/com.joyong.ytsaver/files/videos/<영상ID>/` 에 파일과 `meta.json` 보관 |
| `PlaybackService.kt` | Media3 `MediaSessionService` + ExoPlayer. 영상/소리 파일을 합쳐 재생, 백그라운드 재생 |
| `MainActivity.kt` | 입력·진행률·보관함 목록·플레이어 화면 |

화면이 꺼지면 영상 트랙 디코딩을 끄고 소리만 재생해서 배터리를 아낍니다.

## 유튜브 추출 라이브러리
[NewPipeExtractor](https://github.com/TeamNewPipe/NewPipeExtractor) v0.26.5(GPL-3.0)와 nanojson을
소스에서 빌드한 jar를 `android/app/libs/` 에 넣어 두었습니다(JitPack 없이 빌드되도록).
유튜브가 구조를 바꿔 저장이 안 되기 시작하면 새 버전으로 jar를 교체해야 합니다.

## 주의
개인 소장·오프라인 시청 용도로만 쓰세요. 유튜브 약관상 다운로드는 허용되지 않으며,
다른 사람의 영상을 재배포하면 저작권 침해가 될 수 있습니다.
