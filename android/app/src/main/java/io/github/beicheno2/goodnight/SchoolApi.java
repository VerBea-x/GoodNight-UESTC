package io.github.beicheno2.goodnight;

import android.content.Context;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

final class SchoolApi {
    static final String ORIGIN="https://jzsz.uestc.edu.cn";
    private final Context context;
    SchoolApi(Context c) { context=c; }
    JSONObject get(String path) throws Exception { return request(path,null); }
    JSONObject post(String path,JSONObject body) throws Exception { return request(path,body); }
    private JSONObject request(String path,JSONObject body) throws Exception {
        if (!path.startsWith("/") || path.contains("..")) throw new IllegalArgumentException("invalid_path");
        String cookie=CookieManager.getInstance().getCookie(ORIGIN);
        if(cookie==null||cookie.isEmpty()) throw new IllegalStateException("need_login");
        HttpURLConnection c=(HttpURLConnection)new URL(ORIGIN+"/daily-checkin/api"+path).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(15000); c.setInstanceFollowRedirects(false);
        c.setRequestProperty("platform","h5"); c.setRequestProperty("Cookie",cookie);
        c.setRequestProperty("Accept","application/json");
        c.setRequestProperty("User-Agent",Config.prefs(context).getString("ua","Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"));
        if(body!=null){c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json;charset=UTF-8");try(OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
        int code=c.getResponseCode();
        if(code!=200){c.disconnect();throw new IllegalStateException("http_error_"+code);}
        JSONObject result;
        try(InputStream in=c.getInputStream()){result=new JSONObject(new String(in.readAllBytes(),StandardCharsets.UTF_8));}finally{c.disconnect();}
        if(result.optInt("code",-1)==5000)throw new IllegalStateException("need_login");
        return result;
    }
    static boolean ok(JSONObject j){return j.optInt("code",-1)==0&&j.optBoolean("ok",true);}
}
