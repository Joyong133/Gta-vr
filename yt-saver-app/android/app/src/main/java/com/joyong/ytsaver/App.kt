package com.joyong.ytsaver

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import okhttp3.OkHttpClient
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.localization.ContentCountry
import org.schabi.newpipe.extractor.localization.Localization
import java.util.concurrent.TimeUnit

class App : Application() {

    override fun onCreate() {
        super.onCreate()
        instance = this
        NewPipe.init(
            NetDownloader(http) { CaptchaCookies.get(this) },
            Localization("ko", "KR"),
            ContentCountry("KR"),
        )

        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_DOWNLOAD, "영상 저장", NotificationManager.IMPORTANCE_LOW)
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_DONE, "저장 완료", NotificationManager.IMPORTANCE_DEFAULT)
        )
    }

    companion object {
        const val CHANNEL_DOWNLOAD = "download"
        const val CHANNEL_DONE = "download_done"

        lateinit var instance: App
            private set

        val http: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
    }
}
