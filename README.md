# YouTube Lite TV

[YTLite (YouTube Plus)](https://github.com/dayanch96/YTLite)의 기능을 Android TV용 YouTube 앱(`com.google.android.youtube.tv`)에 옮긴 패치입니다.

## 동작 방식
YouTube TV 6.x는 `youtube.com/tv` 웹 앱을 **Cobalt(Chromium)** 엔진으로 띄우는 구조이고, 광고와 피드 로직은 모두 JS에 있습니다.
그래서 iOS 트윅처럼 네이티브 클래스를 hook하지 않고, 아래 방식으로 동작합니다.

1. **smali 패치(최소한)**: `dev.cobalt.shell.Shell`의 native 콜백(WebContents 연결, 페이지 로딩, URL 변경)에 extension 호출을 삽입합니다.
   `WebContents.evaluateJavaScript`의 난독화된 이름은 패치할 때 fingerprint로 찾아 `app.ytltv.Bridge`를 생성합니다.
2. **JS payload(`extension/assets/ytltv.js`)**: `JSON.parse`와 `Response.json`을 가로채 InnerTube 응답에서 광고, 프로모션, Shorts 데이터를 제거하고,
   `<video>`를 제어해 SponsorBlock과 기본 재생 속도를 적용합니다.
3. **Java extension**: SponsorBlock API 조회(웹 앱 CSP를 우회하려고 Java에서 조회)와,
   재서명 때문에 생기는 GMS DroidGuard `SecurityException` 크래시 방지를 담당합니다.

## 설정
YouTube 앱의 **설정(톱니바퀴) → YOUTUBE PLUS** 섹션에서 바꿉니다. 값은 웹 앱의 `localStorage`(`ytplus.settings`)에 저장됩니다.
- 켜기/끄기 항목은 YouTube 기본 토글(`settingBooleanRenderer`, "사용 / 사용 안함")을 그대로 씁니다.
  토글은 상태를 `ClientSettingService.isEnabled(settingItemIdForClient)`로 읽고, 클릭하면 `_yttv.I().resolveCommand(endpoint)`를 호출합니다.
  그래서 두 함수를 hook해 `YTPLUS_*` 항목만 직접 처리합니다.
- 기본 재생 속도처럼 값이 여러 개인 항목은 단일 선택 메뉴(`settingSingleOptionMenuRenderer`, 라디오 목록)로 표시합니다.
- 참고: `_yttv.I`, `_yttv.C/br`, `_yttv.N/P`는 웹 앱 번들의 축약된 이름입니다. YouTube가 웹 앱을 배포하면서 이 이름이 바뀌면 설정 섹션이 동작하지 않을 수 있습니다.
  광고 차단과 SponsorBlock은 이 이름들에 의존하지 않습니다.

## 사용법
```sh
adb connect <TV_IP>:5555          # 장치가 여러 개면 export ANDROID_SERIAL=<serial>
scripts/pull_apk.sh               # TV에서 원본 APK 추출 → work/original/
scripts/build.sh --package app.ytltv.youtube.tv
scripts/install.sh
```
- 원본 YouTube는 시스템 앱이라 그대로 둡니다. 패치된 앱은 다른 패키지 이름("YouTube Plus", PLUS 배지 배너·아이콘)으로 나란히 설치됩니다.
- split APK의 네이티브 라이브러리는 base에 합쳐 단일 APK로 만듭니다.
- 로그인은 앱의 **"휴대전화로 로그인"(yt.be/activate 코드)** 을 사용하세요. 기기 계정(GMS) 로그인은 서명이 달라 동작하지 않습니다.
- 필요 도구: JDK, Android SDK(build-tools, platforms), `apktool`, `python3`

## YTLite 기능 대응표
| YTLite | TV 포팅 | 구현 |
|---|---|---|
| noAds | 동영상 광고, 홈 마스트헤드, 피드 광고 제거 | JS 응답 필터 + 남은 광고 건너뛰기 |
| noPromotionCards | Premium 가입 유도, 유료 프로모션 안내 제거 | JS 응답 필터 |
| SponsorBlock | 구간 자동 건너뛰기 + 알림 | Java 조회 + JS 건너뛰기 |
| hideShorts | Shorts 선반과 타일 숨기기 | JS 응답 필터 |
| endScreenCards | 최종 화면, 정보 카드 숨기기 | JS 응답 필터 |
| 기본 재생 속도 | 1x ~ 2x | JS |
| 다운로드, 제스처, OLED, 탭 재배치 등 모바일 UI | — | TV에 해당 없음 |

## 구조
| 경로 | 설명 |
|---|---|
| `scripts/` | APK 추출, 빌드, 설치 |
| `patcher/smali.py` | smali 파싱, fingerprint 검색, 코드 삽입 엔진 |
| `patcher/patches.py` | smali 패치 (Shell hook, Bridge 생성, CrashGuard) |
| `patcher/manifest.py` | 앱 이름 변경, 패키지 이름 변경, split 요구 제거 |
| `extension/` | Java extension과 JS payload |

검증 버전: YouTube TV 6.54.310 (armeabi-v7a, Android TV 14)
