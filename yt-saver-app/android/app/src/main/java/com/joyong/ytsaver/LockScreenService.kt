package com.joyong.ytsaver

import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * 튜브 잠금화면: 화면이 꺼질 때마다 LockScreenActivity를 띄워 두어,
 * 화면을 다시 켜면 시스템 잠금화면보다 먼저 보이게 한다.
 * 화면 꺼짐 신호는 실행 중인 앱만 받을 수 있어 알림이 떠 있는 서비스로 계속 실행한다.
 */
class LockScreenService : Service() {

    private val screenOffReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_SCREEN_OFF) showLockScreen()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val openApp = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val notification = NotificationCompat.Builder(this, App.CHANNEL_LOCK)
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentTitle("튜브 잠금화면 사용 중")
            .setContentText("화면을 켜면 튜브 보관함 잠금화면이 먼저 나와요")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(openApp)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        // 화면 꺼짐은 시스템 방송이라 앱 밖으로 노출되지 않는 수신기로도 받는다
        ContextCompat.registerReceiver(
            this, screenOffReceiver, IntentFilter(Intent.ACTION_SCREEN_OFF),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!isEnabled(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    private fun showLockScreen() {
        if (!isEnabled(this)) return
        // 통화 중에는 통화 화면을 가리지 않는다
        val audio = getSystemService(AudioManager::class.java)
        if (audio.mode == AudioManager.MODE_IN_CALL || audio.mode == AudioManager.MODE_IN_COMMUNICATION) return
        // 다른 앱 위에 표시 권한이 있어야 백그라운드에서 화면을 띄울 수 있다
        if (!Settings.canDrawOverlays(this)) return
        runCatching {
            startActivity(
                Intent(this, LockScreenActivity::class.java).addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_NO_ANIMATION or
                        Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
                )
            )
        }
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(screenOffReceiver) }
        super.onDestroy()
    }

    companion object {
        private const val NOTIFICATION_ID = 7

        private fun prefs(context: Context) =
            context.getSharedPreferences("settings", Context.MODE_PRIVATE)

        fun isEnabled(context: Context) = prefs(context).getBoolean("custom_lock_screen", false)

        fun setEnabled(context: Context, enabled: Boolean) {
            prefs(context).edit().putBoolean("custom_lock_screen", enabled).apply()
            if (enabled) start(context) else context.stopService(Intent(context, LockScreenService::class.java))
        }

        /** 켜져 있으면 서비스 시작 (앱 실행·재부팅 때 호출) */
        fun start(context: Context) {
            if (!isEnabled(context)) return
            runCatching {
                ContextCompat.startForegroundService(context, Intent(context, LockScreenService::class.java))
            }
        }
    }
}

/** 폰을 다시 켜면 튜브 잠금화면 서비스도 다시 시작 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            LockScreenService.start(context)
        }
    }
}
