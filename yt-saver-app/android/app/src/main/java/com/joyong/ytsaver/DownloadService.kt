package com.joyong.ytsaver

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

sealed interface DownloadState {
    data object Idle : DownloadState
    data class Running(
        val title: String,
        val done: Long,
        val total: Long,
        val queued: Int,
        val status: String? = null,
    ) : DownloadState
}

/** 앱을 내려도 저장이 끊기지 않도록 포그라운드 서비스에서 순서대로 받는다. */
class DownloadService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    /** 새 영상 저장(url) 또는 이미 저장한 영상에 자막 추가(subtitleFor) */
    private data class Task(
        val url: String? = null,
        val quality: Quality = Quality.P720,
        val withSubtitles: Boolean = true,
        val subtitleFor: String? = null,
    )

    private val queue = Channel<Task>(Channel.UNLIMITED)
    private var worker: Job? = null
    private var current: Job? = null
    private var pending = 0
    private var lastNotifiedPercent = -2
    private var lastStatus: String? = null
    private var doneNotificationId = 100

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ServiceCompat.startForeground(
            this, NOTIFICATION_ID, progressNotification("저장 준비 중…", 0, 0),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        )

        if (intent?.action == ACTION_CANCEL) {
            current?.cancel()
        } else {
            val url = intent?.getStringExtra(EXTRA_URL)
            val subtitleFor = intent?.getStringExtra(EXTRA_SUBTITLE_FOR)
            val quality = intent?.getStringExtra(EXTRA_QUALITY)
                ?.let { runCatching { Quality.valueOf(it) }.getOrNull() } ?: Quality.P720
            val withSubtitles = intent?.getBooleanExtra(EXTRA_SUBTITLES, true) ?: true
            if (url != null || subtitleFor != null) {
                pending++
                queue.trySend(Task(url, quality, withSubtitles, subtitleFor))
            }
        }

        if (pending == 0) {
            stopSelfSafely()
        } else if (worker == null) {
            worker = scope.launch {
                for (task in queue) {
                    val job = launch { process(task) }
                    current = job
                    job.join()
                    current = null
                    pending--
                    if (pending == 0) stopSelfSafely()
                }
            }
        }
        return START_NOT_STICKY
    }

    private suspend fun process(task: Task) {
        _state.value = DownloadState.Running("영상 정보 가져오는 중…", 0, 0, pending - 1)
        lastNotifiedPercent = -2
        lastStatus = null
        val onProgress = { p: YouTubeSaver.Progress ->
            _state.value = DownloadState.Running(p.title, p.done, p.total, pending - 1, p.status)
            updateProgressNotification(p)
        }
        try {
            if (task.subtitleFor != null) {
                val video = Library.find(this, task.subtitleFor)
                    ?: throw SaveException("영상을 찾을 수 없어요")
                val updated = YouTubeSaver.addSubtitles(this, video, onProgress)
                _events.tryEmit(Event.Saved(updated.title, "한국어 자막 저장 완료"))
                notifyDone("자막 저장 완료", updated.title)
            } else {
                val saved = YouTubeSaver.save(this, task.url!!, task.quality, task.withSubtitles, onProgress)
                val note = when {
                    !task.withSubtitles -> "저장 완료"
                    saved.subKo != null -> "저장 완료 (한국어 자막 포함)"
                    else -> "저장 완료 (자막 없음)"
                }
                _events.tryEmit(Event.Saved(saved.title, note))
                notifyDone(note, saved.title)
            }
        } catch (e: CancellationException) {
            _events.tryEmit(Event.Failed("저장을 취소했어요"))
        } catch (e: Exception) {
            val msg = YouTubeSaver.describe(e)
            _events.tryEmit(Event.Failed(msg))
            notifyDone("저장 실패", msg)
        } finally {
            _state.value = DownloadState.Idle
        }
    }

    private fun updateProgressNotification(p: YouTubeSaver.Progress) {
        val percent = if (p.total > 0) (p.done * 100 / p.total).toInt() else -1
        if (percent == lastNotifiedPercent && p.status == lastStatus) return
        lastNotifiedPercent = percent
        lastStatus = p.status
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, progressNotification(p.title, p.done, p.total, p.status))
    }

    private fun progressNotification(
        title: String,
        done: Long,
        total: Long,
        status: String? = null,
    ): Notification {
        val cancel = PendingIntent.getService(
            this, 1, Intent(this, DownloadService::class.java).setAction(ACTION_CANCEL),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val percent = if (total > 0) (done * 100 / total).toInt() else 0
        return NotificationCompat.Builder(this, App.CHANNEL_DOWNLOAD)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title)
            .setContentText(
                status ?: if (total > 0) "$percent% · ${formatSize(done)} / ${formatSize(total)}" else "저장 중…"
            )
            .setProgress(100, percent, total <= 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openAppIntent())
            .addAction(0, "취소", cancel)
            .build()
    }

    private fun notifyDone(title: String, text: String) {
        val notification = NotificationCompat.Builder(this, App.CHANNEL_DONE)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent())
            .build()
        runCatching {
            getSystemService(NotificationManager::class.java).notify(doneNotificationId++, notification)
        }
    }

    private fun openAppIntent() = PendingIntent.getActivity(
        this, 0,
        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    private fun stopSelfSafely() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        scope.cancel()
        _state.value = DownloadState.Idle
        super.onDestroy()
    }

    sealed interface Event {
        data class Saved(val title: String, val note: String) : Event
        data class Failed(val message: String) : Event
    }

    companion object {
        private const val NOTIFICATION_ID = 1
        private const val ACTION_CANCEL = "com.joyong.ytsaver.CANCEL"
        private const val EXTRA_URL = "url"
        private const val EXTRA_QUALITY = "quality"
        private const val EXTRA_SUBTITLES = "subtitles"
        private const val EXTRA_SUBTITLE_FOR = "subtitle_for"

        private val _state = MutableStateFlow<DownloadState>(DownloadState.Idle)
        val state: StateFlow<DownloadState> = _state

        private val _events = MutableSharedFlow<Event>(extraBufferCapacity = 16)
        val events: SharedFlow<Event> = _events

        fun start(context: Context, url: String, quality: Quality, withSubtitles: Boolean) {
            val intent = Intent(context, DownloadService::class.java)
                .putExtra(EXTRA_URL, url)
                .putExtra(EXTRA_QUALITY, quality.name)
                .putExtra(EXTRA_SUBTITLES, withSubtitles)
            ContextCompat.startForegroundService(context, intent)
        }

        fun addSubtitles(context: Context, videoId: String) {
            val intent = Intent(context, DownloadService::class.java)
                .putExtra(EXTRA_SUBTITLE_FOR, videoId)
            ContextCompat.startForegroundService(context, intent)
        }

        fun cancel(context: Context) {
            ContextCompat.startForegroundService(
                context, Intent(context, DownloadService::class.java).setAction(ACTION_CANCEL)
            )
        }
    }
}

fun formatSize(bytes: Long): String = when {
    bytes >= 1L shl 30 -> String.format("%.2fGB", bytes / (1L shl 30).toDouble())
    bytes >= 1L shl 20 -> String.format("%.1fMB", bytes / (1L shl 20).toDouble())
    else -> "${bytes / 1024}KB"
}
