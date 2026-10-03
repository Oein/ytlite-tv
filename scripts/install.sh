#!/usr/bin/env bash
# 패치된 APK를 TV에 설치한다.
set -euo pipefail
OUT="$(cd "$(dirname "$0")/.." && pwd)/work/out"
adb install -r "$OUT/base.apk"
