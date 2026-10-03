package app.ytltv;

/**
 * 재서명된 앱에서 Google Play 서비스(DroidGuard 등)가 패키지 서명 검증을 거부하면
 * 백그라운드 GMS 클라이언트 스레드에서 SecurityException 이 발생해 앱 전체가 종료된다.
 * 해당 예외만 삼켜 그 스레드만 종료되게 하고, 나머지 예외는 원래 핸들러로 넘긴다.
 */
public final class CrashGuard {
    private static boolean installed;

    private CrashGuard() {}

    /** TvRoot_Application.onCreate 시작 시 호출된다. */
    public static synchronized void install() {
        if (installed) return;
        installed = true;
        final Thread.UncaughtExceptionHandler orig = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, e) -> {
            if (isGmsVerificationFailure(thread, e)) {
                Utils.log("GMS 서명 검증 실패를 무시함 (thread=" + thread.getName() + ")", e);
                return;
            }
            if (orig != null) orig.uncaughtException(thread, e);
        });
    }

    private static boolean isGmsVerificationFailure(Thread thread, Throwable e) {
        if (thread == null || thread.getId() == android.os.Looper.getMainLooper().getThread().getId()) return false;
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof SecurityException) {
                String m = String.valueOf(t.getMessage());
                if (m.contains("PackageVerificationRslt") || m.contains("not allowed") || m.contains("Unknown calling package")
                        || m.contains("GoogleCertificatesRslt")) {
                    return true;
                }
            }
        }
        return false;
    }
}
