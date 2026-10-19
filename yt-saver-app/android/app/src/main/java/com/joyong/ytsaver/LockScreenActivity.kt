package com.joyong.ytsaver

import android.animation.ObjectAnimator
import android.content.ClipboardManager
import android.view.inputmethod.InputMethodManager
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.launch
import android.app.KeyguardManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.drawable.BitmapDrawable
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.isVisible
import androidx.core.view.updatePadding
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import com.joyong.ytsaver.databinding.ActivityLockScreenBinding

/**
 * 튜브 잠금화면. 시계, 영상 플레이어, 저장된 영상 목록을 보여 주고
 * 아래 막대를 끝까지 밀면 시스템 잠금 해제(지문·비밀번호 등)로 넘어간다.
 */
class LockScreenActivity : AppCompatActivity() {

    private lateinit var b: ActivityLockScreenBinding
    private lateinit var adapter: VideoAdapter
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private var videos: List<SavedVideo> = emptyList()
    private var fullscreen = false

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) = render()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
        }
        WindowCompat.setDecorFitsSystemWindows(window, false)
        b = ActivityLockScreenBinding.inflate(layoutInflater)
        setContentView(b.root)
        ViewCompat.setOnApplyWindowInsetsListener(b.content) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            if (fullscreen) v.updatePadding(0, 0, 0, 0)
            else v.updatePadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        // 플레이어는 화면 너비에 맞춘 16:9
        b.playerView.layoutParams.height = resources.displayMetrics.widthPixels * 9 / 16
        b.playerView.setFullscreenButtonClickListener { setFullscreen(it) }
        b.playerView.setShowShuffleButton(true)

        adapter = VideoAdapter(
            onClick = ::play,
            onLongClick = { Toast.makeText(this, "잠금을 풀면 메뉴를 쓸 수 있어요", Toast.LENGTH_SHORT).show() },
            historyOf = { WatchHistory.get(this, it) },
        )
        b.list.layoutManager = LinearLayoutManager(this)
        b.list.adapter = adapter

        // 뒤로 가기: 전체화면이면 해제, 아니면 아무것도 안 함 (밀어서 잠금 해제만)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (fullscreen) setFullscreen(false)
            }
        })

        // 잠금 상태에서도 저장: 입력창이 비어 있으면 클립보드의 링크를 쓴다
        b.saveButton.setOnClickListener {
            val typed = b.urlInput.text?.toString().orEmpty()
            val text = typed.ifBlank {
                getSystemService(ClipboardManager::class.java).primaryClip
                    ?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString().orEmpty()
            }
            val url = YouTubeSaver.extractUrl(text)
            if (url == null || runCatching { YouTubeSaver.videoId(url) }.isFailure) {
                Toast.makeText(this, "유튜브 링크를 넣어 주세요", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            DownloadService.startWithSavedSettings(this, url)
            b.urlInput.setText("")
            getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(b.urlInput.windowToken, 0)
            Toast.makeText(this, "저장을 시작했어요", Toast.LENGTH_SHORT).show()
        }
        b.findButton.setOnClickListener { SearchActivity.open(this, fromLock = true) }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    DownloadService.state.collect { s ->
                        b.downloadStatus.isVisible = s is DownloadState.Running
                        if (s is DownloadState.Running) {
                            val pct = if (s.total > 0) " ${s.done * 100 / s.total}%" else ""
                            b.downloadStatus.text = "⬇ ${s.title}$pct" + (s.status?.let { " · $it" } ?: "")
                        }
                    }
                }
                launch {
                    DownloadService.events.collect { e ->
                        if (e is DownloadService.Event.Saved) {
                            Toast.makeText(this@LockScreenActivity, "${e.note}: ${e.title}", Toast.LENGTH_SHORT).show()
                            refreshList()
                        }
                    }
                }
                launch {
                    DownloadService.failure.collect { f ->
                        if (f != null) {
                            DownloadService.clearFailure()
                            Toast.makeText(this@LockScreenActivity, f.message, Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
        }

        b.slider.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar, progress: Int, fromUser: Boolean) {
                b.slideHint.alpha = 1f - progress / 100f
            }

            override fun onStartTrackingTouch(seekBar: SeekBar) = Unit

            override fun onStopTrackingTouch(seekBar: SeekBar) {
                if (seekBar.progress >= 90) unlock() else resetSlider()
            }
        })
    }

    override fun onStart() {
        super.onStart()
        resetSlider(animate = false)
        refreshList()

        val token = SessionToken(this, ComponentName(this, PlaybackService::class.java))
        val future = MediaController.Builder(this, token).buildAsync()
        controllerFuture = future
        future.addListener({
            val c = runCatching { future.get() }.getOrNull() ?: return@addListener
            controller = c
            c.addListener(listener)
            setVideoTrackEnabled(c, true)
            b.playerView.player = c
            if (c.mediaItemCount == 0) restoreLastSession(c)
            render()
        }, MoreExecutors.directExecutor())
        render()
    }

    private fun refreshList() {
        videos = Library.list(this)
        adapter.submit(videos)
        b.list.isVisible = videos.isNotEmpty() && !fullscreen
        b.emptyText.isVisible = videos.isEmpty() && !fullscreen
        b.listHeader.text = if (videos.isEmpty()) "저장된 영상" else "저장된 영상 ${videos.size}개"
    }

    override fun onStop() {
        controller?.let {
            // 화면이 꺼져 있는 동안은 소리만 (배터리 절약)
            setVideoTrackEnabled(it, false)
            it.removeListener(listener)
        }
        b.playerView.player = null
        controller = null
        controllerFuture?.let { MediaController.releaseFuture(it) }
        controllerFuture = null
        super.onStop()
    }

    private fun setVideoTrackEnabled(c: MediaController, enabled: Boolean) {
        c.trackSelectionParameters = c.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, !enabled)
            .build()
    }

    /** 마지막으로 보던 영상을 그 위치에 (일시정지 상태로) 준비 */
    private fun restoreLastSession(c: MediaController) {
        val (list, index, position) = WatchHistory.restore(this) ?: return
        c.setMediaItems(list.map { it.toMediaItem() }, index, position)
        c.prepare()
    }

    /** 누른 영상부터 목록 전체를 재생. 보던 영상이면 이어서 */
    private fun play(video: SavedVideo) {
        val c = controller ?: return
        if (c.currentMediaItem?.mediaId == video.id && c.playbackState != Player.STATE_ENDED) {
            if (c.playbackState == Player.STATE_IDLE) c.prepare()
            c.play()
            return
        }
        val start = videos.indexOfFirst { it.id == video.id }.coerceAtLeast(0)
        c.setMediaItems(videos.map { it.toMediaItem() }, start, WatchHistory.resumePosition(this, video.id))
        c.prepare()
        c.play()
    }

    private fun render() {
        val c = controller
        val active = c != null && c.mediaItemCount > 0
        b.playerView.isVisible = active
        b.nowPlaying.isVisible = active && !fullscreen
        val id = c?.currentMediaItem?.mediaId
        adapter.playingId = if (active) id else null
        val video = id?.let { Library.find(this, it) }
        b.nowPlaying.text = video?.title.orEmpty()
        val thumb = video?.thumbFile?.let { Thumbs.get(it) }
        b.background.setImageBitmap(thumb)
        b.playerView.defaultArtwork = thumb?.let { BitmapDrawable(resources, it) }
    }

    private fun setFullscreen(enable: Boolean) {
        fullscreen = enable
        b.clockRow.isVisible = !enable
        b.saveRow.isVisible = !enable
        if (enable) b.downloadStatus.isVisible = false
        b.listHeader.isVisible = !enable
        b.list.isVisible = !enable && videos.isNotEmpty()
        b.emptyText.isVisible = !enable && videos.isEmpty()
        b.sliderBox.isVisible = !enable
        b.nowPlaying.isVisible = !enable && (controller?.mediaItemCount ?: 0) > 0
        val lp = b.playerView.layoutParams as LinearLayout.LayoutParams
        if (enable) {
            lp.height = 0
            lp.weight = 1f
        } else {
            lp.height = resources.displayMetrics.widthPixels.coerceAtMost(resources.displayMetrics.heightPixels) * 9 / 16
            lp.weight = 0f
        }
        b.playerView.layoutParams = lp
        b.playerView.setFullscreenButtonState(enable)
        val insets = WindowCompat.getInsetsController(window, window.decorView)
        if (enable) {
            insets.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            insets.hide(WindowInsetsCompat.Type.systemBars())
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        } else {
            insets.show(WindowInsetsCompat.Type.systemBars())
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
        ViewCompat.requestApplyInsets(b.content)
    }

    /** 시스템 잠금 해제로 넘긴다. 잠금이 없거나 밀어서 해제 방식이면 바로 풀린다 */
    private fun unlock() {
        val km = getSystemService(KeyguardManager::class.java)
        if (!km.isKeyguardLocked) {
            finish()
            return
        }
        km.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
            override fun onDismissSucceeded() = finish()
            override fun onDismissCancelled() = resetSlider()
            override fun onDismissError() = finish()
        })
    }

    private fun resetSlider(animate: Boolean = true) {
        if (animate) {
            ObjectAnimator.ofInt(b.slider, "progress", b.slider.progress, 0).setDuration(200).start()
        } else {
            b.slider.progress = 0
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        resetSlider(animate = false)
    }
}
