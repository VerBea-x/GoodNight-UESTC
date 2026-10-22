package io.github.beicheno2.goodnight;

import android.content.Context;
import android.content.SharedPreferences;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import org.json.JSONArray;
import org.json.JSONObject;

final class CheckinEngine {
    private final Context context;
    private final SharedPreferences prefs;
    private final SchoolApi api;
    CheckinEngine(Context c){context=c;prefs=Config.prefs(c);api=new SchoolApi(c);}
    static final class Result {
        final String code, detail;
        Result(String code,String detail){this.code=code;this.detail=detail;}
        boolean finalToday(){return code.equals("success")||code.equals("already_done")||code.equals("pending_review")||code.equals("need_login");}
    }
    private Result result(String code,String detail){
        prefs.edit().putString("last_status",code).putString("last_detail",detail).putLong("last_at",System.currentTimeMillis()).apply();
        try{long now=System.currentTimeMillis(),cutoff=now-30L*24*60*60*1000;String today=java.time.Instant.ofEpochMilli(now).atZone(Config.ZONE).toLocalDate().toString();JSONArray history=new JSONArray(prefs.getString("history","[]"));JSONObject item=new JSONObject();item.put("at",now);item.put("code",code);item.put("detail",detail);JSONArray next=new JSONArray();next.put(item);for(int i=0;i<history.length();i++){JSONObject old=history.optJSONObject(i);if(old==null)continue;long at=old.optLong("at",0);if(at>=cutoff||java.time.Instant.ofEpochMilli(at).atZone(Config.ZONE).toLocalDate().toString().equals(today))next.put(old);}prefs.edit().putString("history",next.toString()).apply();}catch(Exception ignored){}
        return new Result(code,detail);
    }
    private static double distance(double a,double b,double c,double d){
        double x=Math.toRadians(a-c),y=Math.toRadians(b-d);
        double h=Math.pow(Math.sin(x/2),2)+Math.cos(Math.toRadians(a))*Math.cos(Math.toRadians(c))*Math.pow(Math.sin(y/2),2);
        return 12756274*Math.asin(Math.sqrt(Math.min(1,h)));
    }
    Result run(boolean submit){
        synchronized(CheckinEngine.class){
            try{return perform(submit);}catch(Exception e){String m=e.getMessage();return result("need_login".equals(m)?"need_login":"error","need_login".equals(m)?"应用内尚未取得学校登录会话。请在“查看学校页面”中完成登录并进入“晚安成电”，再重试只读检查。":m==null?"运行失败":m);}
        }
    }
    private Result perform(boolean submit)throws Exception{
        if(!Config.valid(context))return result("config_error","请先保存有效位置和时间");
        ZonedDateTime now=ZonedDateTime.now(Config.ZONE);String date=now.toLocalDate().toString();
        JSONObject auth=api.get("/auth/user-info");if(!SchoolApi.ok(auth)||auth.isNull("data"))return result("need_login","请重新登录学校账号");
        JSONObject today=api.get("/student-checkin-record/today");
        if(!SchoolApi.ok(today)||today.optJSONObject("data")==null)return result("unknown","无法读取学校当天记录");
        JSONObject record=today.getJSONObject("data");
        if(!date.equals(record.optString("businessDate")))return result("unknown","学校业务日期与北京时间不一致");
        String status=record.optString("recordStatusCode");
        if("CHECKED_IN".equals(status)||"STUDENT_REPORTED".equals(status)||"INSTRUCTOR_REPORTED".equals(status))return result("already_done","学校记录已完成，请核对");
        if(!"PENDING".equals(status))return result("unknown","学校记录状态未知："+status);
        if(!Config.within(context))return result("outside_plan","当前不在设定时段内");
        JSONObject schedule=api.get("/checkin-schedule/effective");if(!SchoolApi.ok(schedule)||schedule.optJSONObject("data")==null)return result("unknown","无法读取学校签到时间");
        JSONObject s=schedule.getJSONObject("data");
        int start=s.optInt("studentCheckinStartOffsetMinute",-1),end=s.optInt("studentCheckinEndOffsetMinute",-1);
        if(start<0||end<=start)return result("unknown","学校签到时间无效");
        int minute=now.getHour()*60+now.getMinute();
        if(minute<start)return result("waiting","学校签到尚未开放");
        if(minute>=Math.min(end,1440)-5)return result("window_missed","学校签到时间已结束");
        JSONObject locations=api.get("/checkin-location/available-locations");
        if(!SchoolApi.ok(locations)||locations.optJSONArray("data")==null)return result("unknown","无法读取学校签到点");
        double lat=Config.latitude(context),lng=Config.longitude(context);JSONArray places=locations.getJSONArray("data");boolean inside=false;
        for(int i=0;i<places.length();i++){JSONObject p=places.optJSONObject(i);if(p!=null&&p.has("latitude")&&p.has("longitude")&&p.has("radiusMeter")&&p.optDouble("radiusMeter",0)>0&&distance(lat,lng,p.optDouble("latitude"),p.optDouble("longitude"))<=p.optDouble("radiusMeter")){inside=true;break;}}
        if(!inside)return result("location_fail","选定位置不在学校当前有效签到范围内");
        if(!submit)return result("ready","只读检查通过，可在时段内尝试签到");
        String journal=prefs.getString("journal_date","");
        if(date.equals(journal))return verify(date,"pending_review");
        JSONObject fresh=api.get("/student-checkin-record/today");
        if(!SchoolApi.ok(fresh)||fresh.optJSONObject("data")==null||!date.equals(fresh.getJSONObject("data").optString("businessDate"))||!"PENDING".equals(fresh.getJSONObject("data").optString("recordStatusCode")))return result("unknown","提交前学校记录已变化");
        String address="";
        try{JSONObject reverse=api.get("/map/reverse?lat="+lat+"&lng="+lng);if(SchoolApi.ok(reverse))address=reverse.optString("data","");}catch(Exception ignored){}
        JSONObject body=new JSONObject();body.put("latitude",lat);body.put("longitude",lng);body.put("reverseGeocode",address);body.put("userAgent",prefs.getString("ua","Android WebView"));body.put("clientTime",now.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")));body.put("accuracy",20);
        // Commit before the network POST. An ambiguous response never triggers a second POST today.
        if(!prefs.edit().putString("journal_date",date).commit())return result("error","无法保存提交记录");
        try{api.post("/student-checkin-record/checkin",body);}catch(Exception ignored){}
        for(int attempt=0;attempt<3;attempt++){Thread.sleep(1500L*(attempt+1));Result verified=verify(date,"pending_review");if(!verified.code.equals("pending_review"))return verified;}
        return result("pending_review","已尝试签到，学校记录尚未确认；请手动核对");
    }
    private Result verify(String date,String uncertain)throws Exception{
        JSONObject r=api.get("/student-checkin-record/today");
        if(!SchoolApi.ok(r)||r.optJSONObject("data")==null)return result(uncertain,"无法回读学校记录，请手动核对");
        JSONObject d=r.getJSONObject("data");
        if(!date.equals(d.optString("businessDate")))return result(uncertain,"学校业务日期变化，请手动核对");
        if("CHECKED_IN".equals(d.optString("recordStatusCode")))return result("success","学校记录已确认签到");
        if("PENDING".equals(d.optString("recordStatusCode")))return result(uncertain,"学校记录仍待确认，请手动核对");
        return result("already_done","学校记录状态："+d.optString("recordStatusCode")+"，请核对");
    }
}
