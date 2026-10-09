package com.joyong.nihongo;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 재부팅 후 학습 알림을 다시 예약한다. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) ReminderReceiver.schedule(ctx);
    }
}
