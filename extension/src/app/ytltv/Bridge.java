package app.ytltv;

/**
 * 컴파일용 스텁. 실제 구현은 패치 시 patcher가 생성하는 smali로 교체된다.
 * (WebContents.evaluateJavaScript 의 난독화된 메서드 이름이 버전마다 다르기 때문)
 */
public final class Bridge {
    private Bridge() {}

    public static void eval(Object webContents, String js) {
        throw new UnsupportedOperationException("Bridge 패치가 적용되지 않음");
    }
}
