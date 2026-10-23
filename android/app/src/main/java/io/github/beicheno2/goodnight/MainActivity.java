package io.github.beicheno2.goodnight;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.content.res.ColorStateList;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.URLSpan;
import android.text.style.ClickableSpan;
import android.view.View;
import android.text.method.LinkMovementMethod;
import java.time.LocalTime;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final int NAVY=0xff142442, BLUE=0xff245bd0, MUTED=0xff65748d, PALE=0xffedf2fb;
    private static final DateTimeFormatter CLOCK=DateTimeFormatter.ofPattern("HH:mm");
    private LinearLayout content;
    private EditText lat,lng;
    private Switch autoSwitch;
    private TextView status,summary;
    private LocalTime startTime,endTime;
    private boolean running;
    private int dp(int n){return (int)(n*getResources().getDisplayMetrics().density);}
    private GradientDrawable background(int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;}
    private RippleDrawable touchBackground(int color,int radius){return new RippleDrawable(ColorStateList.valueOf(0x33718799),background(color,radius),null);}
    private TextView text(String value,int size,int color){TextView v=new TextView(this);v.setText(value);v.setTextSize(size);v.setTextColor(color);return v;}
    private LinearLayout card(){LinearLayout c=new LinearLayout(this);c.setOrientation(LinearLayout.VERTICAL);c.setPadding(dp(18),dp(18),dp(18),dp(18));c.setBackground(background(Color.WHITE,18));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.topMargin=dp(14);content.addView(c,p);return c;}
    private void heading(LinearLayout parent,String title,String subtitle){TextView h=text(title,19,NAVY);h.setTypeface(null,Typeface.BOLD);parent.addView(h);if(!subtitle.isEmpty()){TextView s=text(subtitle,13,MUTED);s.setPadding(0,dp(5),0,0);parent.addView(s);}}
    private Button button(LinearLayout parent,String title,boolean primary,Runnable action){Button b=new Button(this);b.setText(title);b.setTextSize(14);b.setAllCaps(false);b.setTextColor(NAVY);b.setBackground(touchBackground(0xffe9edf2,12));b.setElevation(dp(2));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(48));p.topMargin=dp(10);parent.addView(b,p);b.setOnClickListener(v->action.run());return b;}
    private void smallButton(LinearLayout parent,String title,Runnable action){Button b=new Button(this);b.setText(title);b.setTextSize(12);b.setAllCaps(false);b.setMinWidth(0);b.setMinimumWidth(0);b.setPadding(dp(9),0,dp(9),0);b.setTextColor(NAVY);b.setBackground(touchBackground(0xffe9edf2,18));b.setElevation(dp(2));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-2,dp(36));p.leftMargin=dp(7);parent.addView(b,p);b.setOnClickListener(v->action.run());}
    private EditText coordinate(LinearLayout parent,String title,String value){TextView label=text(title,13,MUTED);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.topMargin=dp(13);parent.addView(label,lp);EditText input=new EditText(this);input.setSingleLine(true);input.setInputType(InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL|InputType.TYPE_NUMBER_FLAG_SIGNED);input.setTextSize(16);input.setTextColor(NAVY);input.setText(value);input.setPadding(dp(12),0,dp(12),0);input.setBackground(background(PALE,10));parent.addView(input,new LinearLayout.LayoutParams(-1,dp(45)));return input;}
    private void timeButton(LinearLayout parent,String label,LocalTime initial,boolean isStart){Button b=button(parent,label+"  "+initial.format(CLOCK),false,()->{});b.setOnClickListener(v->{LocalTime current=isStart?startTime:endTime;new TimePickerDialog(this,(picker,hour,minute)->{LocalTime chosen=LocalTime.of(hour,minute);if(isStart)startTime=chosen;else endTime=chosen;b.setText(label+"  "+chosen.format(CLOCK));},current.getHour(),current.getMinute(),true).show();});}
    @Override public void onCreate(Bundle state){super.onCreate(state);render();if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},12);}
    @Override protected void onResume(){super.onResume();refresh();updateSchoolStatus();}
    private void updateSchoolStatus(){long now=System.currentTimeMillis();if(running||now-Config.prefs(this).getLong("last_auth_check",0)<60000)return;running=true;new Thread(()->{String detail;try{JSONObject auth=new SchoolApi(this).get("/auth/user-info");detail=SchoolApi.ok(auth)&&!auth.isNull("data")?"学校登录有效":"请在应用内登录学校账号";}catch(Exception e){detail="请在应用内登录学校账号";}final String shown=detail;Config.prefs(this).edit().putString("account_status",shown).putLong("last_auth_check",System.currentTimeMillis()).apply();runOnUiThread(()->{running=false;if(status!=null)status.setText(shown);});},"goodnight-auth-status").start();}
    private void render(){
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(PALE);content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);content.setPadding(dp(16),dp(24),dp(16),dp(28));scroll.addView(content);setContentView(scroll);
        LinearLayout top=new LinearLayout(this);top.setOrientation(LinearLayout.HORIZONTAL);top.setGravity(Gravity.CENTER_VERTICAL);content.addView(top);
        TextView title=text("☾ 晚安成电",25,NAVY);title.setTypeface(null,Typeface.BOLD);top.addView(title,new LinearLayout.LayoutParams(0,-2,1));
        smallButton(top,"粘贴配置",this::showImportDialog);smallButton(top,"签到记录",()->startActivity(new Intent(this,HistoryActivity.class)));
        LinearLayout result=card();heading(result,"学校登录状态","");status=text("尚未检查",16,NAVY);status.setTypeface(null,Typeface.BOLD);status.setPadding(0,dp(10),0,0);result.addView(status);summary=text("",13,MUTED);summary.setPadding(0,dp(5),0,0);result.addView(summary);
        button(result,"学校登录",false,()->startActivity(new Intent(this,LoginActivity.class)));
        LinearLayout place=card();heading(place,"签到坐标","");
        lat=coordinate(place,"纬度 · GCJ-02",Config.valid(this)?String.format(Locale.US,"%.6f",Config.latitude(this)):"");
        lng=coordinate(place,"经度 · GCJ-02",Config.valid(this)?String.format(Locale.US,"%.6f",Config.longitude(this)):"");
        LinearLayout plan=card();heading(plan,"签到时间","");
        startTime=Config.time(this,"start","21:00");endTime=Config.time(this,"end","23:00");
        timeButton(plan,"开始",startTime,true);timeButton(plan,"截止",endTime,false);
        autoSwitch=new Switch(this);autoSwitch.setText("自动签到");autoSwitch.setTextSize(16);autoSwitch.setTextColor(NAVY);autoSwitch.setChecked(Config.prefs(this).getBoolean("enabled",false));LinearLayout.LayoutParams toggle=new LinearLayout.LayoutParams(-1,dp(52));toggle.topMargin=dp(12);plan.addView(autoSwitch,toggle);autoSwitch.setOnCheckedChangeListener((view,checked)->toggleAuto(checked));
        addNotice();
    }
    private void addNotice(){TextView note=text("GoodNight 项目；早期地图交互参考 GoGoGo，未使用其代码。\n本项目仅供学习交流。请遵守学校规定，并在使用前阅读本项目免责声明。",12,MUTED);note.setLineSpacing(dp(4),1);note.setPadding(dp(3),dp(18),dp(3),dp(8));String value=note.getText().toString();SpannableString spans=new SpannableString(value);int start=value.indexOf("GoodNight");spans.setSpan(new URLSpan("https://github.com/beichenO2/GoodNight"),start,start+"GoodNight".length(),Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);start=value.indexOf("GoGoGo");spans.setSpan(new URLSpan("https://github.com/ZCShou/GoGoGo"),start,start+"GoGoGo".length(),Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);start=value.indexOf("本项目免责声明");spans.setSpan(new ClickableSpan(){@Override public void onClick(View widget){showDisclaimer();}},start,start+"本项目免责声明".length(),Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);note.setText(spans);note.setLinkTextColor(MUTED);note.setMovementMethod(LinkMovementMethod.getInstance());content.addView(note);}
    private void showDisclaimer(){new AlertDialog.Builder(this).setTitle("本项目免责声明").setMessage("GoodNight 是个人学习、研究与交流用途的开源项目，不是电子科技大学或地图服务商的官方产品。\n\n请遵守学校规定及适用法律，仅使用自己有权操作的账号，确保提交信息符合实际情况。请勿伪造出勤或规避管理要求。使用虚拟坐标和自动签到产生的后果由使用者自行承担。\n\n自动任务可能因网络、登录状态、设备省电或学校接口变化而延迟或失败。请在学校官方页面核对当天记录。\n\n请妥善保管学校凭证、Cookie、配置和日志，不要公开或发送给他人。本项目按 MIT 许可证提供，与学校无官方关联。").setPositiveButton("我知道了",null).show();}
    private void showImportDialog(){EditText input=new EditText(this);input.setHint("粘贴从电脑端复制的配置文字");input.setMinLines(4);input.setMaxLines(8);input.setTextSize(14);input.setPadding(dp(16),dp(12),dp(16),dp(12));
        ClipboardManager clipboard=(ClipboardManager)getSystemService(Context.CLIPBOARD_SERVICE);if(clipboard!=null&&clipboard.hasPrimaryClip()&&clipboard.getPrimaryClip()!=null){CharSequence value=clipboard.getPrimaryClip().getItemAt(0).coerceToText(this);if(value!=null&&value.length()<=65536)input.setText(value);}
        new AlertDialog.Builder(this).setTitle("导入电脑配置").setMessage("将复制的配置发送到手机后，粘贴在下方。导入不会开启自动计划。").setView(input).setNegativeButton("取消",null).setPositiveButton("导入",(dialog,which)->importConfig(input.getText().toString())).show();}
    private void importConfig(String value){try{if(value.length()>65536)throw new IllegalArgumentException();JSONObject json=new JSONObject(value);if(!"goodnight-mobile-config".equals(json.getString("format"))||json.getInt("version")!=1||!"GCJ-02".equals(json.getString("coordinateSystem")))throw new IllegalArgumentException();
            double a=json.getDouble("latitude"),b=json.getDouble("longitude");LocalTime start=LocalTime.parse(json.getString("start")),end=LocalTime.parse(json.getString("end"));if(!Double.isFinite(a)||!Double.isFinite(b)||Math.abs(a)>90||Math.abs(b)>180||!start.isBefore(end))throw new IllegalArgumentException();
            Config.location(this,a,b);Config.prefs(this).edit().putString("start",start.format(CLOCK)).putString("end",end.format(CLOCK)).putBoolean("enabled",false).apply();CheckinJob.schedule(this,false);render();refresh();Toast.makeText(this,"配置已导入；请先只读检查登录和今日记录，再开启计划",Toast.LENGTH_LONG).show();
        }catch(Exception error){Toast.makeText(this,"配置文字无效或不受支持",Toast.LENGTH_LONG).show();}}
    private void refresh(){
        if(status==null)return;
        String code=Config.prefs(this).getString("last_status","");status.setText(Config.prefs(this).getString("account_status","正在检查学校登录…"));
        long at=Config.prefs(this).getLong("last_at",0);String when=at>0?java.time.Instant.ofEpochMilli(at).atZone(Config.ZONE).format(DateTimeFormatter.ofPattern("M月d日 HH:mm")):"尚未运行";
        String plan=Config.prefs(this).getBoolean("enabled",false)?"自动计划已开启":"自动计划未开启";
        String notification=Config.prefs(this).getString("notification_status","");
        summary.setText(when+" · "+plan+" · "+Config.time(this,"start","21:00").format(CLOCK)+"–"+Config.time(this,"end","23:00").format(CLOCK)+(notification.isEmpty()?"":" · "+notification));
        boolean today=at>0&&java.time.Instant.ofEpochMilli(at).atZone(Config.ZONE).toLocalDate().equals(LocalDate.now(Config.ZONE));
        boolean complete=today&&(code.equals("success")||code.equals("already_done"));
        if(lat!=null&&Config.valid(this)&&!lat.hasFocus()&&!lng.hasFocus()){lat.setText(String.format(Locale.US,"%.6f",Config.latitude(this)));lng.setText(String.format(Locale.US,"%.6f",Config.longitude(this)));}
    }
    private void setSwitch(boolean checked){autoSwitch.setOnCheckedChangeListener(null);autoSwitch.setChecked(checked);autoSwitch.setOnCheckedChangeListener((view,value)->toggleAuto(value));}
    private void toggleAuto(boolean checked){
        double a=0,b=0;
        if(checked){
            try{a=Double.parseDouble(lat.getText().toString().trim());b=Double.parseDouble(lng.getText().toString().trim());}
            catch(NumberFormatException error){setSwitch(false);Toast.makeText(this,"请填写有效的经纬度",Toast.LENGTH_LONG).show();return;}
            if(!Double.isFinite(a)||!Double.isFinite(b)||Math.abs(a)>90||Math.abs(b)>180||startTime==null||endTime==null||!startTime.isBefore(endTime)){
                setSwitch(false);Toast.makeText(this,"请检查经纬度和时间",Toast.LENGTH_LONG).show();return;
            }
        }
        final double latitude=a,longitude=b;
        final String start=startTime.format(CLOCK),end=endTime.format(CLOCK);
        // Let the switch animate immediately; durable encryption and IPC run off the UI thread.
        autoSwitch.setEnabled(false);
        new Thread(()->{
            String failure=null;
            try{
                SecurePrefs.Editor editor=Config.prefs(this).edit().putBoolean("enabled",checked);
                if(checked)editor.putLong("lat",Double.doubleToRawLongBits(latitude)).putLong("lng",Double.doubleToRawLongBits(longitude)).putString("start",start).putString("end",end);
                if(!editor.commit())throw new IllegalStateException("无法保存计划");
                CheckinJob.schedule(this,false);
            }catch(Exception error){
                failure="计划更新失败，请重试";
                try{Config.prefs(this).edit().putBoolean("enabled",false).commit();CheckinJob.schedule(this,false);}catch(Exception ignored){}
            }
            final String message=failure;
            runOnUiThread(()->{if(isDestroyed())return;if(message!=null){setSwitch(false);Toast.makeText(this,message,Toast.LENGTH_LONG).show();}autoSwitch.setEnabled(true);refresh();});
        },"goodnight-plan-save").start();
    }
}
