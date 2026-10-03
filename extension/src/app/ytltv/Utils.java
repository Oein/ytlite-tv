package app.ytltv;

import android.annotation.SuppressLint;
import android.content.Context;
import android.util.Log;

public final class Utils {
    public static final String TAG = "YTLiteTV";

    private static Context context;

    private Utils() {}

    /** 훅 없이 현재 Application 컨텍스트를 얻는다. */
    @SuppressLint("PrivateApi")
    public static Context context() {
        if (context == null) {
            try {
                Object app = Class.forName("android.app.ActivityThread")
                        .getMethod("currentApplication").invoke(null);
                if (app != null) context = ((Context) app).getApplicationContext();
            } catch (Throwable t) {
                Log.e(TAG, "context", t);
            }
        }
        return context;
    }

    public static void log(String msg) {
        Log.d(TAG, msg);
    }

    public static void log(String msg, Throwable t) {
        Log.e(TAG, msg, t);
    }
}
