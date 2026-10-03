"""AndroidManifest.xml(apktool로 디코딩된 텍스트) 수정."""
from __future__ import annotations

import re
from pathlib import Path

APP_LABEL = "YouTube Plus"


def patch_manifest(path: Path, old_pkg: str, new_pkg: str | None, gms_vendor: str | None) -> None:
    xml = path.read_text(encoding="utf-8")

    # 0) 분할 APK 요구 제거: split 의 네이티브 라이브러리를 base 에 합쳐 단일 APK 로 만든다(build.sh)
    xml = re.sub(r' android:(?:requiredSplitTypes|splitTypes|isSplitRequired)="[^"]*"', "", xml)
    xml = re.sub(r'\s*<meta-data android:name="com\.android\.vending\.splits(?:\.required)?"[^>]*/>', "", xml)

    # 1) 런처에서 원본과 구분되도록 앱 이름 변경 (배너 · 아이콘 이미지는 build.sh 에서 교체)
    xml = re.sub(r'(<application [^>]*?android:label=")[^"]*(")', rf"\g<1>{APP_LABEL}\2", xml, count=1)

    # 2) 패키지 이름 변경: 시스템 앱으로 설치된 원본 YouTube와 나란히 설치하기 위함
    if new_pkg and new_pkg != old_pkg:
        xml = xml.replace(f'package="{old_pkg}"', f'package="{new_pkg}"', 1)
        # provider authority / 커스텀 permission 이 원본과 충돌하지 않도록 변경
        xml = re.sub(
            rf'(android:(?:authorities|name|permission|taskAffinity)="){re.escape(old_pkg)}(\.[^"]*(?:provider|permission|PERMISSION|Provider|FileProvider)[^"]*")',
            rf"\g<1>{new_pkg}\2",
            xml,
        )
        xml = re.sub(rf'android:authorities="{re.escape(old_pkg)}', f'android:authorities="{new_pkg}', xml)

    # 3) GmsCore(microG) 사용: 서명이 바뀐 앱은 Google Play 서비스 로그인이 거부되므로 대체 GMS로 연결
    if gms_vendor:
        xml = xml.replace('"com.google.android.c2dm.permission.', f'"{gms_vendor}.android.c2dm.permission.')

    path.write_text(xml, encoding="utf-8")
