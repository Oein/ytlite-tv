#!/usr/bin/env python3
"""디컴파일된 YouTube TV 앱(apktool 출력 디렉터리)에 YTLite TV 패치를 적용한다."""
from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from manifest import patch_manifest  # noqa: E402
from patches import PATCHES  # noqa: E402
from smali import PatchError, SmaliTree  # noqa: E402

ORIG_PKG = "com.google.android.youtube.tv"
GMS_STRINGS = [
    # GmsCore(microG) 지원: ReVanced의 GmsCoreSupport 패치와 같은 방식으로 GMS 패키지 참조를 바꾼다.
    "com.google.android.gms",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("decoded", type=Path)
    ap.add_argument("--package", default=None, help="새 패키지 이름 (기본: 변경 안 함)")
    ap.add_argument("--gms-vendor", default=None, help="예: app.revanced  (GmsCore 사용 시)")
    ap.add_argument("--only", nargs="*", help="지정한 패치만 적용")
    args = ap.parse_args()

    tree = SmaliTree(args.decoded)
    failed_required = False
    for name, required, fn in PATCHES:
        if args.only and name not in args.only:
            continue
        try:
            fn(tree)
            print(f"  [ok]   {name}")
        except PatchError as e:
            print(f"  [fail] {name}: {e}")
            failed_required |= required
        except Exception:
            print(f"  [err]  {name}")
            traceback.print_exc()
            failed_required |= required

    if args.gms_vendor:
        n = 0
        for s in GMS_STRINGS:
            n += tree.replace_in_all(f'"{s}"', f'"{args.gms_vendor}.android.gms"')
        print(f"  [ok]   GmsCore -> {args.gms_vendor}.android.gms ({n} files)")

    tree.save()
    patch_manifest(args.decoded / "AndroidManifest.xml", ORIG_PKG, args.package, args.gms_vendor)
    print("  [ok]   manifest")
    return 1 if failed_required else 0


if __name__ == "__main__":
    sys.exit(main())
