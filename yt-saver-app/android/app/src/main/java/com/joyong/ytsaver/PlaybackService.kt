package com.joyong.ytsaver

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.drm.DrmSessionManagerProvider
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.MergingMediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * 실제 재생을 담당하는 서비스. 앱을 최소화하거나 화면을 꺼도
 * 이 서비스가 알림(재생 컨트롤)과 함께 계속 소리를 낸다.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {

    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(SavedMediaSourceFactory(this))
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                    .build(),
                true
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .build()

        val openApp = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        session = MediaSession.Builder(this, player)
            .setSessionActivity(openApp)
            .setCallback(object : MediaSession.Callback {
                // 컨트롤러는 mediaId만 넘기므로 보관함에서 실제 파일 경로를 찾아 채운다
                override fun onAddMediaItems(
                    mediaSession: MediaSession,
                    controller: MediaSession.ControllerInfo,
                    mediaItems: MutableList<MediaItem>,
                ): ListenableFuture<MutableList<MediaItem>> = Futures.immediateFuture(
                    mediaItems.mapNotNull { item ->
                        Library.find(this@PlaybackService, item.mediaId)?.toMediaItem()
                            ?: item.takeIf { it.localConfiguration != null }
                    }.toMutableList()
                )
            })
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        // 최근 앱 목록에서 지워도 재생 중이면 계속, 멈춰 있으면 종료
        val player = session?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }
}

/**
 * 영상(화면)과 소리를 따로 저장한 경우 두 파일을 합쳐서 하나처럼 재생한다.
 */
@OptIn(UnstableApi::class)
class SavedMediaSourceFactory(private val context: Context) : MediaSource.Factory {

    private val progressive = ProgressiveMediaSource.Factory(DefaultDataSource.Factory(context))

    override fun setDrmSessionManagerProvider(provider: DrmSessionManagerProvider): MediaSource.Factory {
        progressive.setDrmSessionManagerProvider(provider)
        return this
    }

    override fun setLoadErrorHandlingPolicy(policy: LoadErrorHandlingPolicy): MediaSource.Factory {
        progressive.setLoadErrorHandlingPolicy(policy)
        return this
    }

    override fun getSupportedTypes(): IntArray = intArrayOf(C.CONTENT_TYPE_OTHER)

    override fun createMediaSource(mediaItem: MediaItem): MediaSource {
        val saved = Library.find(context, mediaItem.mediaId)
            ?: return progressive.createMediaSource(mediaItem)
        val mainFile = saved.videoFile ?: saved.audioFile!!
        val main = progressive.createMediaSource(
            mediaItem.buildUpon().setUri(Uri.fromFile(mainFile)).build()
        )
        val audioFile = saved.audioFile
        if (saved.videoFile == null || audioFile == null) return main
        val audio = progressive.createMediaSource(MediaItem.fromUri(Uri.fromFile(audioFile)))
        return MergingMediaSource(main, audio)
    }
}
