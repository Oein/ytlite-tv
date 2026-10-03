"""YTLite 기능을 YouTube TV(Cobalt)에 적용하는 smali 패치 목록.

YouTube TV 6.x 는 youtube.com/tv 웹 앱을 Cobalt(Chromium) 로 띄우는 구조라,
광고 · 피드 로직은 전부 JS 에 있다. 따라서 smali 패치는 JS 주입 지점만 만들고,
실제 기능은 extension/assets/ytltv.js 가 담당한다.
"""
from __future__ import annotations

from smali import Fingerprint, PatchError, SmaliTree

EXT_INJECTOR = "Lapp/ytltv/Injector;"
SHELL = "Ldev/cobalt/shell/Shell;"
WEB_CONTENTS = "Lcobalt/org/chromium/content_public/browser/WebContents;"

PATCHES: list = []


def patch(name: str, required: bool = False):
    def deco(fn):
        PATCHES.append((name, required, fn))
        return fn

    return deco


def _shell_method(tree: SmaliTree, name: str, params: str):
    f = tree.find_class(SHELL)
    if f is None:
        raise PatchError(f"{SHELL} 없음")
    for m in f.methods():
        if m.name == name and m.params == params:
            return m
    raise PatchError(f"{SHELL}->{name}({params}) 없음")


@patch("js-bridge", required=True)
def js_bridge(tree: SmaliTree) -> None:
    """app.ytltv.Bridge.eval(Object, String) 를 생성: WebContents.evaluateJavaScript 의 난독화된 이름을 찾아 호출."""
    impl = tree.find_one(
        Fingerprint(
            "WebContentsImpl.evaluateJavaScript(String)",
            contains=["WebContentsImpl_evaluateJavaScript(JLjava/lang/String;"],
            params="Ljava/lang/String;",
            ret="V",
        )
    )
    iface = tree.find_class(WEB_CONTENTS)
    if iface is None or not any(m.name == impl.name and m.params == impl.params for m in iface.methods()):
        raise PatchError(f"{WEB_CONTENTS} 에 {impl.name}(String) 가 선언되어 있지 않음")
    out = tree.dirs[-1] / "app/ytltv/Bridge.smali"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        f""".class public final Lapp/ytltv/Bridge;
.super Ljava/lang/Object;

# patcher 생성: {impl.ref}
.method public static eval(Ljava/lang/Object;Ljava/lang/String;)V
    .locals 0
    check-cast p0, {WEB_CONTENTS}
    invoke-interface {{p0, p1}}, {WEB_CONTENTS}->{impl.name}(Ljava/lang/String;)V
    return-void
.end method
""",
        encoding="utf-8",
    )


@patch("webcontents-hook", required=True)
def webcontents_hook(tree: SmaliTree) -> None:
    """Shell 이 WebContents 를 붙일 때 Injector 에 전달한다."""
    for name in ("initFromNativeTabContents", "updateNativeTabContents"):
        m = _shell_method(tree, name, WEB_CONTENTS)
        m.insert_at_start(f"    invoke-static {{p1}}, {EXT_INJECTOR}->onWebContents(Ljava/lang/Object;)V\n")


@patch("page-event-hook", required=True)
def page_event_hook(tree: SmaliTree) -> None:
    """페이지 로딩 진행 / 로딩 상태 / URL 변경 시마다 스크립트 주입을 시도한다(가드로 1회만 실행)."""
    for name, params in (("onLoadProgressChanged", "D"), ("setIsLoading", "Z")):
        m = _shell_method(tree, name, params)
        m.insert_at_start(f"    invoke-static {{}}, {EXT_INJECTOR}->onPageEvent()V\n")
    # URL 변경(SPA 내 이동 포함): 스크립트 주입 + SponsorBlock 구간 조회
    m = _shell_method(tree, "onUpdateUrl", "Ljava/lang/String;")
    m.insert_at_start(f"    invoke-static {{p1}}, {EXT_INJECTOR}->onUrl(Ljava/lang/String;)V\n")


@patch("gms-crash-guard", required=True)
def gms_crash_guard(tree: SmaliTree) -> None:
    """재서명으로 인한 GMS(DroidGuard) SecurityException 이 앱을 종료시키지 않도록 Application 시작 시 핸들러 설치."""
    f = tree.find_class("Lcom/google/android/apps/youtube/tv/application/TvRoot_Application;")
    if f is None:
        raise PatchError("TvRoot_Application 없음")
    m = next((m for m in f.methods() if m.name == "onCreate" and m.params == ""), None)
    if m is None:
        raise PatchError("TvRoot_Application.onCreate 없음")
    m.insert_at_start("    invoke-static {}, Lapp/ytltv/CrashGuard;->install()V\n")
