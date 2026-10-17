package com.joyong.ytsaver

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.drm.DrmSessionManagerProvider
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.MergingMediaSource
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSession.MediaItemsWithStartPosition
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * 실제 재생을 담당하는 서비스. 앱을 최소화하거나 화면을 꺼도
 * 이 서비스가 알림(재생 컨트롤)과 함께 계속 소리를 낸다.
 * 재생 위치는 몇 초마다 시청 기록에 저장한다.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {

    private var session: MediaSession? = null
    private lateinit var player: ExoPlayer
    private val handler = Handler(Looper.getMainLooper())

    // 다음 영상으로 넘어간 뒤에는 이전 영상의 위치를 알 수 없으므로 마지막 값을 들고 있는다
    private var lastId: String? = null
    private var lastPosition = 0L
    private var lastDuration = 0L

    private val ticker = object : Runnable {
        override fun run() {
            persist()
            handler.postDelayed(this, 5_000)
        }
    }

    override fun onCreate() {
        super.onCreate()
        player = ExoPlayer.Builder(this)
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
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setPreferredTextLanguage("ko")
            .build()
        player.addListener(historyListener)

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

                // 앱이 완전히 꺼진 뒤 알림/블루투스 재생 버튼을 누르면 마지막 재생목록을 이어서
                override fun onPlaybackResumption(
                    mediaSession: MediaSession,
                    controller: MediaSession.ControllerInfo,
                ): ListenableFuture<MediaItemsWithStartPosition> {
                    val restored = WatchHistory.restore(this@PlaybackService)
                        ?: return Futures.immediateFailedFuture(
                            UnsupportedOperationException("재생 기록 없음")
                        )
                    val (videos, index, position) = restored
                    return Futures.immediateFuture(
                        MediaItemsWithStartPosition(videos.map { it.toMediaItem() }, index, position)
                    )
                }
            })
            .build()
    }

    private val historyListener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            persist()
            handler.removeCallbacks(ticker)
            if (isPlaying) handler.postDelayed(ticker, 5_000)
        }

        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int,
        ) {
            if (reason == Player.DISCONTINUITY_REASON_SEEK) persist()
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            // 이전 영상 기록 마무리: 끝까지 봐서 넘어갔으면 다 본 것으로
            lastId?.let { id ->
                if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) {
                    WatchHistory.markFinished(this@PlaybackService, id)
                } else {
                    WatchHistory.save(this@PlaybackService, id, lastPosition, lastDuration)
                }
            }
            lastId = mediaItem?.mediaId
            lastPosition = 0
            lastDuration = 0
            // 재생목록에서 다음 영상으로 넘어가면 그 영상을 보던 위치부터
            if (mediaItem != null &&
                (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO ||
                    reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK)
            ) {
                val resume = WatchHistory.resumePosition(this@PlaybackService, mediaItem.mediaId)
                if (resume > 0) player.seekTo(resume)
            }
            persist()
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_ENDED) {
                player.currentMediaItem?.mediaId?.let {
                    WatchHistory.markFinished(this@PlaybackService, it)
                }
            }
        }

        override fun onTimelineChanged(timeline: Timeline, reason: Int) {
            if (player.mediaItemCount == 0) {
                WatchHistory.clearSession(this@PlaybackService)
                lastId = null
            }
        }
    }

    /** 현재 영상 위치 + 재생목록 전체를 저장 */
    private fun persist() {
        val item = player.currentMediaItem ?: return
        val duration = player.duration
        if (duration == C.TIME_UNSET || duration <= 0) return
        val position = player.currentPosition
        lastId = item.mediaId
        lastPosition = position
        lastDuration = duration
        if (player.playbackState != Player.STATE_ENDED) {
            WatchHistory.save(this, item.mediaId, position, duration)
        }
        WatchHistory.saveSession(
            this,
            (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId },
            player.currentMediaItemIndex,
            position,
        )
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        persist()
        // 최근 앱 목록에서 지워도 재생 중이면 계속, 멈춰 있으면 종료
        if (!player.playWhenReady || player.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        persist()
        handler.removeCallbacks(ticker)
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }
}

/**
 * 영상(화면)과 소리를 따로 저장한 경우 두 파일을 합쳐서 하나처럼 재생하고,
 * 저장해 둔 자막 파일(한국어/원어)도 붙인다.
 */
@OptIn(UnstableApi::class)
class SavedMediaSourceFactory(private val context: Context) : MediaSource.Factory {

    private val defaultFactory = DefaultMediaSourceFactory(context)

    override fun setDrmSessionManagerProvider(provider: DrmSessionManagerProvider): MediaSource.Factory {
        defaultFactory.setDrmSessionManagerProvider(provider)
        return this
    }

    override fun setLoadErrorHandlingPolicy(policy: LoadErrorHandlingPolicy): MediaSource.Factory {
        defaultFactory.setLoadErrorHandlingPolicy(policy)
        return this
    }

    override fun getSupportedTypes(): IntArray = defaultFactory.supportedTypes

    override fun createMediaSource(mediaItem: MediaItem): MediaSource {
        val saved = Library.find(context, mediaItem.mediaId)
            ?: return defaultFactory.createMediaSource(mediaItem)

        val subtitles = buildList {
            saved.subKo?.let {
                add(subtitle(it, "ko", "한국어", C.SELECTION_FLAG_DEFAULT))
            }
            saved.subOrig?.let {
                add(subtitle(it, saved.subOrigLang.ifEmpty { null }, "원어 (${saved.subOrigLang})", 0))
            }
        }
        val mainFile = saved.videoFile ?: saved.audioFile!!
        val main = defaultFactory.createMediaSource(
            mediaItem.buildUpon()
                .setUri(Uri.fromFile(mainFile))
                .setSubtitleConfigurations(subtitles)
                .build()
        )
        val audioFile = saved.audioFile
        if (saved.videoFile == null || audioFile == null) return main
        val audio = defaultFactory.createMediaSource(MediaItem.fromUri(Uri.fromFile(audioFile)))
        return MergingMediaSource(main, audio)
    }

    private fun subtitle(file: java.io.File, language: String?, label: String, flags: Int) =
        MediaItem.SubtitleConfiguration.Builder(Uri.fromFile(file))
            .setMimeType(MimeTypes.TEXT_VTT)
            .setLanguage(language)
            .setLabel(label)
            .setSelectionFlags(flags)
            .build()
}
