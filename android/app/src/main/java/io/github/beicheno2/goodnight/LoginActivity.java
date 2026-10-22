package io.github.beicheno2.goodnight;

import android.app.Activity;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class LoginActivity extends Activity {
    private WebView browser;
    @Override public void onCreate(Bundle state){super.onCreate(state);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(0xfff5f7fc);
        TextView hint=new TextView(this);hint.setText("请在此窗口进入“晚安成电”。若需要学校认证，请在此完成。Chrome 中已登录不会自动转到本应用；返回后点“只读检查登录与今日记录”。");hint.setTextSize(15);hint.setPadding(20,18,20,18);root.addView(hint);
        browser=new WebView(this);browser.getSettings().setJavaScriptEnabled(true);browser.getSettings().setDomStorageEnabled(true);
        browser.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !"https".equals(request.getUrl().getScheme());}});
        browser.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(browser,true);
        Config.prefs(this).edit().putString("ua",browser.getSettings().getUserAgentString()).apply();
        root.addView(browser,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);
        browser.loadUrl("https://jzsz.uestc.edu.cn/#/hall/home");
    }
    @Override public void onBackPressed(){if(browser.canGoBack())browser.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){CookieManager.getInstance().flush();Config.prefs(this).edit().putLong("last_auth_check",0).apply();browser.destroy();super.onDestroy();}
}
