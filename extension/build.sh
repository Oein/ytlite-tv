#!/usr/bin/env bash
# extension Java 소스를 dex로 컴파일한다. 결과: work/extension/classes.dex
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"
JAR="$(ls -d "$SDK"/platforms/android-* | sort -V | tail -1)/android.jar"
OUT=../work/extension
rm -rf "$OUT" && mkdir -p "$OUT/classes"
javac -source 8 -target 8 -nowarn -Xlint:-options -cp "$JAR" -d "$OUT/classes" $(find src -name '*.java')
# Bridge 는 컴파일용 스텁이다. 실제 구현은 patcher 가 smali 로 생성하므로 dex 에서 제외한다.
"$BT/d8" --min-api 21 --lib "$JAR" --output "$OUT" $(find "$OUT/classes" -name '*.class' ! -name 'Bridge.class')
cp assets/ytltv.js "$OUT/ytltv.js"
echo "extension dex: $OUT/classes.dex"
