package app.ytltv;

import android.os.Handler;
import android.os.Looper;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.ref.WeakReference;

/**
 * youtube.com/tv 웹 앱(Cobalt)에 YouTube Plus 스크립트(assets/ytltv.js)를 주입한다.
 * dev.cobalt.shell.Shell 의 native 콜백(페이지 로딩/URL 변경)에서 호출된다.
 * 스크립트는 window.__ytltv 가드로 문서당 한 번만 실행된다.
 */
public final class Injector {
    private static WeakReference<Object> webContents = new WeakReference<>(null);
    private static String payload;
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final Runnable tick = new Runnable() {
        @Override
        public void run() {
            inject();
            main.postDelayed(this, 2000);
        }
    };

    private Injector() {}

    /** Shell.initFromNativeTabContents / updateNativeTabContents */
    public static void onWebContents(Object wc) {
        if (wc == null) return;
        webContents = new WeakReference<>(wc);
        Utils.log("WebContents ready: " + wc.getClass().getName());
        main.removeCallbacks(tick);
        main.post(tick); // 새로고침 등으로 문서가 바뀌어도 다시 주입되도록 주기적으로 확인
    }

    /** Shell.onLoadProgressChanged / setIsLoading */
    public static void onPageEvent() {
        inject();
    }

    /** Shell.onUpdateUrl */
    public static void onUrl(String url) {
        inject();
        SponsorBlock.onUrl(url);
    }

    /** 임의의 스크립트를 메인 스레드에서 실행한다. */
    public static void eval(final String js) {
        main.post(() -> {
            Object wc = webContents.get();
            if (wc == null) return;
            try {
                Bridge.eval(wc, js);
            } catch (Throwable t) {
                Utils.log("eval", t);
            }
        });
    }

    private static void inject() {
        Object wc = webContents.get();
        if (wc == null) return;
        try {
            Bridge.eval(wc, script());
        } catch (Throwable t) {
            Utils.log("inject", t);
        }
    }

    private static String script() throws Exception {
        if (payload == null) {
            try (InputStream in = Utils.context().getAssets().open("ytltv.js")) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                payload = out.toString("UTF-8");
            }
        }
        return "if(!window.__ytltv){\n" + payload + "\n}";
    }
}
