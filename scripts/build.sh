#!/usr/bin/env bash
# YouTube TV APK에 YTLite TV 패치를 적용해 서명된 APK를 만든다.
#   사용법: scripts/build.sh [--package <새 패키지>] [--gms-vendor app.revanced]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"
W="$ROOT/work"
ORIG="$W/original"
OUT="$W/out"
KS="$ROOT/ytltv.keystore"

[ -f "$ORIG/base.apk" ] || { echo "work/original/base.apk 가 없습니다. scripts/pull_apk.sh 를 먼저 실행하세요." >&2; exit 1; }

echo "==> extension 빌드"
"$ROOT/extension/build.sh" >/dev/null

echo "==> 디컴파일"
rm -rf "$W/decoded"
apktool d -f -o "$W/decoded" "$ORIG/base.apk" >/dev/null

echo "==> 패치 적용"
python3 "$ROOT/patcher/main.py" "$W/decoded" "$@"
# 런처 배너 · 아이콘을 PLUS 배지 이미지로 교체 (extension/res/make_banner.py, make_icon.py 로 생성)
cp "$ROOT/extension/res/app_banner.png" "$W/decoded/res/drawable/app_banner.png"
for d in "$ROOT"/extension/res/mipmap-*; do
  cp "$d/ic_launcher.png" "$W/decoded/res/$(basename "$d")/ic_launcher.png"
done

echo "==> 리빌드"
rm -rf "$OUT" && mkdir -p "$OUT"
apktool b -o "$OUT/base-unsigned.apk" "$W/decoded" >/dev/null

echo "==> split 의 네이티브 라이브러리를 base 에 병합 (단일 APK)"
rm -rf "$W/libs" && mkdir -p "$W/libs"
for s in "$ORIG"/*.apk; do
  [ "$(basename "$s")" = base.apk ] && continue
  unzip -q -o "$s" 'lib/*' -d "$W/libs" 2>/dev/null || true
done
if [ -d "$W/libs/lib" ]; then
  # extractNativeLibs=false 이므로 .so 는 무압축(-0)으로 넣고 zipalign -p 로 페이지 정렬한다.
  (cd "$W/libs" && zip -q -0 -r "$OUT/base-unsigned.apk" lib)
fi

echo "==> extension dex · 스크립트 추가"
n=$(unzip -l "$OUT/base-unsigned.apk" | grep -cE ' classes[0-9]*\.dex$')
tmp="$W/dexadd" && rm -rf "$tmp" && mkdir -p "$tmp/assets"
cp "$W/extension/classes.dex" "$tmp/classes$((n + 1)).dex"
cp "$W/extension/ytltv.js" "$tmp/assets/ytltv.js"
(cd "$tmp" && zip -q -0 "$OUT/base-unsigned.apk" "classes$((n + 1)).dex" assets/ytltv.js)

if [ ! -f "$KS" ]; then
  echo "==> 서명 키 생성 ($KS)"
  keytool -genkeypair -keystore "$KS" -storepass ytltv123 -keypass ytltv123 -alias ytltv \
    -keyalg RSA -keysize 2048 -validity 36500 -dname "CN=YTLiteTV" >/dev/null 2>&1
fi

sign() { # in out
  "$BT/zipalign" -f -p 4 "$1" "$2.aligned"
  "$BT/apksigner" sign --ks "$KS" --ks-pass pass:ytltv123 --ks-key-alias ytltv --out "$2" "$2.aligned"
  rm -f "$2.aligned" "$2.idsig"
}

echo "==> 서명"
sign "$OUT/base-unsigned.apk" "$OUT/base.apk"
rm -f "$OUT/base-unsigned.apk"
echo "완료: $OUT"
ls -la "$OUT"
