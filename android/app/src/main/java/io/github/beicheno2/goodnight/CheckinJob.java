package io.github.beicheno2.goodnight;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZonedDateTime;

public final class CheckinJob extends JobService {
    private static final int JOB_ID=294;
    static void schedule(Context c,boolean retry){
        JobScheduler scheduler=(JobScheduler)c.getSystemService(JOB_SCHEDULER_SERVICE);
        if(scheduler==null)throw new IllegalStateException("系统定时服务不可用");
        scheduler.cancel(JOB_ID);
        if(!Config.prefs(c).getBoolean("enabled",false)||!Config.valid(c))return;
        ZonedDateTime now=ZonedDateTime.now(Config.ZONE);
        ZonedDateTime start=now.toLocalDate().atTime(Config.time(c,"start","21:00")).atZone(Config.ZONE);
        ZonedDateTime end=now.toLocalDate().atTime(Config.time(c,"end","23:00")).atZone(Config.ZONE);
        ZonedDateTime target;
        if(now.toLocalDate().toString().equals(Config.prefs(c).getString("last_terminal_date","")))target=start.plusDays(1);
        else if(now.isBefore(start))target=start;
        else if(now.isBefore(end))target=now.plusMinutes(retry?15:1);
        else target=start.plusDays(1);
        if(target.isAfter(end)&&target.toLocalDate().equals(now.toLocalDate()))target=start.plusDays(1);
        long delay=Math.max(1000,java.time.Duration.between(now,target).toMillis());
        JobInfo job=new JobInfo.Builder(JOB_ID,new ComponentName(c,CheckinJob.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true)
            .setMinimumLatency(delay).setOverrideDeadline(delay+10*60_000L).build();
        if(scheduler.schedule(job)!=JobScheduler.RESULT_SUCCESS)throw new IllegalStateException("系统未接受定时任务");
    }
    @Override public boolean onStartJob(JobParameters params){
        new Thread(()->{
            CheckinEngine.Result result=new CheckinEngine(this).run(true);
            boolean terminal=result.finalToday();
            if(!result.code.equals("waiting"))notifyUser(result);
            if(terminal){Config.prefs(this).edit().putString("last_terminal_date",ZonedDateTime.now(Config.ZONE).toLocalDate().toString()).apply();}
            schedule(this,!terminal);
            jobFinished(params,false);
        },"goodnight-checkin").start();
        return true;
    }
    @Override public boolean onStopJob(JobParameters params){return true;}
    private void notifyUser(CheckinEngine.Result r){
        NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        manager.createNotificationChannel(new NotificationChannel("checkin","签到结果",NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        String title=r.code.equals("success")||r.code.equals("already_done")?"晚安成电 · 今日记录已确认":"晚安成电 · 请查看签到结果";
        Notification notification=new Notification.Builder(this,"checkin").setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title).setContentText(r.detail).setStyle(new Notification.BigTextStyle().bigText(r.detail))
            .setAutoCancel(true).setContentIntent(open).build();
        try{manager.notify(294,notification);}catch(SecurityException ignored){}
    }
}
