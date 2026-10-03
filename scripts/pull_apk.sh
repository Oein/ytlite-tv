#!/usr/bin/env bash
# 연결된 Android TV에서 YouTube TV APK(분할 APK 포함)를 추출한다.
set -euo pipefail
PKG="${PKG:-com.google.android.youtube.tv}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/work/original"

adb get-state >/dev/null
rm -rf "$OUT" && mkdir -p "$OUT"
paths=$(adb shell pm path "$PKG" | tr -d '\r' | sed 's/^package://')
[ -n "$paths" ] || { echo "패키지 $PKG 가 설치되어 있지 않습니다." >&2; exit 1; }
for p in $paths; do
  echo "pull $p"
  adb pull "$p" "$OUT/" >/dev/null
done
adb shell dumpsys package "$PKG" | tr -d '\r' | awk '/versionName/{print $1; exit}' > "$OUT/VERSION" || true
echo "완료: $OUT ($(cat "$OUT/VERSION"))"
ls -la "$OUT"
