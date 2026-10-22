package io.github.beicheno2.goodnight;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.graphics.Color;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import org.json.JSONArray;
import org.json.JSONObject;
import android.widget.Toast;

public final class HistoryActivity extends Activity {
    private LinearLayout list;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private boolean refreshing;
    private final Runnable refreshLoop=new Runnable(){@Override public void run(){refreshRecords();handler.postDelayed(this,5*60*1000);}};
    private int dp(int n){return (int)(n*getResources().getDisplayMetrics().density);}
    @Override public void onCreate(Bundle state){super.onCreate(state);ScrollView scroll=new ScrollView(this);scroll.setBackgroundColor(0xfff3f6fc);list=new LinearLayout(this);list.setOrientation(LinearLayout.VERTICAL);list.setPadding(dp(18),dp(22),dp(18),dp(24));scroll.addView(list);setContentView(scroll);showHistory();}
    @Override protected void onResume(){super.onResume();handler.post(refreshLoop);}
    @Override protected void onPause(){handler.removeCallbacks(refreshLoop);super.onPause();}
    private void refreshRecords(){if(refreshing)return;refreshing=true;new Thread(()->{new CheckinEngine(this).run(false);runOnUiThread(()->{refreshing=false;showHistory();});},"goodnight-history-refresh").start();}
    private void clearHistory(){new AlertDialog.Builder(this).setTitle("清除本机记录").setMessage("将清除全部本机签到历史，包括今天的记录。学校保存的签到结果不会删除。").setNegativeButton("取消",null).setPositiveButton("清除",(dialog,which)->{
        try{if(!Config.prefs(this).edit().putString("history","[]").commit())throw new IllegalStateException();showHistory();Toast.makeText(this,"本机记录已清除",Toast.LENGTH_SHORT).show();
        }catch(Exception error){Toast.makeText(this,"清除失败，请重试",Toast.LENGTH_SHORT).show();}
    }).show();}
    private void showHistory(){list.removeAllViews();LinearLayout header=new LinearLayout(this);header.setGravity(Gravity.CENTER_VERTICAL);list.addView(header);TextView title=new TextView(this);title.setText("签到记录");title.setTextSize(25);title.setTextColor(0xff142442);header.addView(title,new LinearLayout.LayoutParams(0,-2,1));Button clear=new Button(this);clear.setText("清除");clear.setAllCaps(false);clear.setTextColor(0xff24334d);clear.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xffe9edf2));header.addView(clear);clear.setOnClickListener(v->clearHistory());
        try{JSONArray items=new JSONArray(Config.prefs(this).getString("history","[]"));if(items.length()==0){TextView empty=new TextView(this);empty.setText("暂无记录");empty.setPadding(0,dp(20),0,0);list.addView(empty);}
            for(int i=0;i<items.length();i++){JSONObject item=items.getJSONObject(i);LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(16),dp(14),dp(16),dp(14));card.setBackgroundColor(Color.WHITE);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.topMargin=dp(10);list.addView(card,p);
                TextView time=new TextView(this);time.setText(Instant.ofEpochMilli(item.optLong("at")).atZone(Config.ZONE).format(DateTimeFormatter.ofPattern("M月d日 HH:mm"))+" · "+item.optString("code"));time.setTextColor(0xff65748d);card.addView(time);
                TextView detail=new TextView(this);detail.setText(item.optString("detail"));detail.setTextSize(15);detail.setTextColor(0xff142442);detail.setPadding(0,dp(6),0,0);card.addView(detail);}
        }catch(Exception error){TextView issue=new TextView(this);issue.setText("记录暂时无法读取");list.addView(issue);}}
}
