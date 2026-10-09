package com.joyong.nihongo;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.Calendar;
import java.util.Random;

/** 매일 정해진 시간에 학습 알림을 보낸다. */
public class ReminderReceiver extends BroadcastReceiver {
    private static final String PREFS = "reminder";
    private static final String CHANNEL = "study_reminder";
    private static final String[] MESSAGES = {
            "🔥 오늘의 일본어 학습으로 연속 기록을 이어가요!",
            "📘 5분만 투자해도 실력은 쌓여요. がんばって!",
            "🃏 복습 카드가 기다리고 있어요. 잊기 전에 복습!",
            "🎮 챌린지 레슨 하나 어때요? 하트가 가득 찼어요!",
            "🌸 継続は力なり — 계속하는 것이 힘이에요.",
            "🧘 집중 모드 25분으로 오늘의 목표를 채워 봐요.",
    };

    @Override
    public void onReceive(Context ctx, Intent intent) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "학습 알림", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("매일 일본어 학습 시간을 알려 드려요");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle("일본어 마스터")
                .setContentText(MESSAGES[new Random().nextInt(MESSAGES.length)])
                .setContentIntent(pi)
                .setAutoCancel(true);
        try {
            nm.notify(1001, b.build());
        } catch (SecurityException ignored) {
            // 알림 권한이 없는 경우
        }
        schedule(ctx);
    }

    static void save(Context ctx, int hour, int minute) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        p.edit().putInt("hour", hour).putInt("minute", minute).apply();
    }

    private static PendingIntent pending(Context ctx) {
        Intent i = new Intent(ctx, ReminderReceiver.class);
        return PendingIntent.getBroadcast(ctx, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void schedule(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int hour = p.getInt("hour", -1);
        int minute = p.getInt("minute", -1);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        am.cancel(pending(ctx));
        if (hour < 0) return;
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, hour);
        c.set(Calendar.MINUTE, minute);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        if (c.getTimeInMillis() <= System.currentTimeMillis() + 1000) c.add(Calendar.DAY_OF_YEAR, 1);
        // 매번 다음 하루치만 예약하고, 알림이 울리면 다시 예약한다 (Doze 모드에서도 대략적인 시간 보장)
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, c.getTimeInMillis(), pending(ctx));
    }

    static void cancel(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(pending(ctx));
    }
}
