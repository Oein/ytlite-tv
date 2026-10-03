package app.ytltv;

import org.json.JSONArray;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SponsorBlock(sponsor.ajay.app) 구간 조회.
 * youtube.com/tv 의 CSP 때문에 웹 앱 안에서는 외부 API 를 fetch 할 수 없으므로 Java 에서 조회한 뒤
 * window.__ytltvSetSegments(videoId, segments) 로 JS 에 전달한다. 건너뛰기 자체는 ytltv.js 가 한다.
 */
public final class SponsorBlock {
    private static final String API = "https://sponsor.ajay.app/api/skipSegments";
    private static final String[] CATEGORIES = {
            "sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "music_offtopic"};
    private static final Pattern VIDEO_ID = Pattern.compile("[?&]v=([\\w-]{11})");
    private static volatile String lastId;

    private SponsorBlock() {}

    public static void onUrl(String url) {
        // 사용 여부는 JS 설정(localStorage)이 결정하므로 여기서는 항상 조회만 한다.
        if (url == null) return;
        Matcher m = VIDEO_ID.matcher(url);
        if (!m.find()) return;
        final String id = m.group(1);
        if (id.equals(lastId)) return;
        lastId = id;
        new Thread(() -> fetch(id), "YTLiteTV-SB").start();
    }

    private static void fetch(String id) {
        String body = "[]";
        HttpURLConnection c = null;
        try {
            StringBuilder q = new StringBuilder(API).append("?videoID=").append(id);
            for (String cat : CATEGORIES) {
                q.append("&category=").append(URLEncoder.encode(cat, "UTF-8"));
            }
            c = (HttpURLConnection) new URL(q.toString()).openConnection();
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            if (c.getResponseCode() == 200) { // 404 = 구간 없음
                StringBuilder sb = new StringBuilder();
                try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line);
                }
                body = new JSONArray(sb.toString()).toString(); // 유효한 JSON 인지 확인 후 그대로 전달
            }
        } catch (Throwable t) {
            Utils.log("SponsorBlock fetch " + id, t);
            lastId = null; // 다음 URL 이벤트에서 재시도
            return;
        } finally {
            if (c != null) c.disconnect();
        }
        Utils.log("SponsorBlock " + id + ": " + body.length() + " bytes");
        Injector.eval("window.__ytltvSetSegments&&window.__ytltvSetSegments('" + id + "'," + body + ");");
    }
}
