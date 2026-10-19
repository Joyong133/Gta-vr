package com.joyong.ytsaver

import android.animation.ObjectAnimator
import android.app.KeyguardManager
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.SeekBar
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.isVisible
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import com.joyong.ytsaver.databinding.ActivityLockScreenBinding

/**
 * 튜브 잠금화면. 시계·날짜와 지금 재생 중인 영상의 컨트롤을 보여 주고,
 * 아래 막대를 끝까지 밀면 시스템 잠금 해제(지문·비밀번호 등)로 넘어간다.
 */
class LockScreenActivity : AppCompatActivity() {

    private lateinit var b: ActivityLockScreenBinding
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null

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
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.navigationBars())
        }
        b = ActivityLockScreenBinding.inflate(layoutInflater)
        setContentView(b.root)

        // 뒤로 가기로는 닫히지 않는다 (밀어서 잠금 해제만)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = Unit
        })

        b.prev.setOnClickListener { controller?.seekToPreviousMediaItem() }
        b.next.setOnClickListener { controller?.seekToNextMediaItem() }
        b.playPause.setOnClickListener { togglePlay() }

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
        val token = SessionToken(this, ComponentName(this, PlaybackService::class.java))
        val future = MediaController.Builder(this, token).buildAsync()
        controllerFuture = future
        future.addListener({
            val c = runCatching { future.get() }.getOrNull() ?: return@addListener
            controller = c
            c.addListener(listener)
            render()
        }, MoreExecutors.directExecutor())
        render()
    }

    override fun onStop() {
        controller?.removeListener(listener)
        controller = null
        controllerFuture?.let { MediaController.releaseFuture(it) }
        controllerFuture = null
        super.onStop()
    }

    private fun togglePlay() {
        val c = controller ?: return
        if (c.mediaItemCount == 0) {
            // 재생 목록이 비어 있으면 마지막으로 보던 영상을 이어서
            val (videos, index, position) = WatchHistory.restore(this) ?: return
            c.setMediaItems(videos.map { it.toMediaItem() }, index, position)
            c.prepare()
            c.play()
        } else if (c.isPlaying) {
            c.pause()
        } else {
            c.play()
        }
    }

    private fun render() {
        val c = controller
        val id = c?.currentMediaItem?.mediaId
            ?: WatchHistory.loadSession(this)?.let { it.ids.getOrNull(it.index) }
        val video = id?.let { Library.find(this, it) }
        b.mediaCard.isVisible = video != null
        b.title.text = video?.title.orEmpty()
        b.uploader.text = video?.uploader.orEmpty()
        val thumb = video?.thumbFile?.let { Thumbs.get(it) }
        b.thumb.setImageBitmap(thumb)
        b.background.setImageBitmap(thumb)
        b.playPause.setImageResource(
            if (c?.isPlaying == true) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        )
        val hasItems = (c?.mediaItemCount ?: 0) > 0
        b.prev.isVisible = hasItems
        b.next.isVisible = hasItems
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
