package com.joyong.ytsaver

import android.Manifest
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.graphics.drawable.BitmapDrawable
import android.os.Build
import android.os.Bundle
import android.view.inputmethod.InputMethodManager
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.isVisible
import androidx.core.view.updatePadding
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import com.joyong.ytsaver.databinding.ActivityMainBinding
import kotlinx.coroutines.launch

@OptIn(UnstableApi::class)
class MainActivity : AppCompatActivity() {

    private lateinit var b: ActivityMainBinding
    private lateinit var adapter: VideoAdapter
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private var fullscreen = false
    private var videos: List<SavedVideo> = emptyList()

    private val prefs by lazy { getSharedPreferences("settings", MODE_PRIVATE) }

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    private val playerListener = object : Player.Listener {
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = syncPlayerUi()
        override fun onPlaybackStateChanged(playbackState: Int) = syncPlayerUi()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)

        ViewCompat.setOnApplyWindowInsetsListener(b.root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            if (fullscreen) v.updatePadding(0, 0, 0, 0)
            else v.updatePadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        adapter = VideoAdapter(onClick = ::play, onLongClick = ::confirmDelete)
        b.list.layoutManager = LinearLayoutManager(this)
        b.list.adapter = adapter

        val savedQuality = prefs.getString("quality", Quality.P720.name)
        Quality.entries.forEach { q ->
            chipFor(q).isChecked = q.name == savedQuality
        }

        b.saveButton.setOnClickListener { startSave(b.urlInput.text?.toString().orEmpty()) }
        b.pasteButton.setOnClickListener {
            val clip = getSystemService(ClipboardManager::class.java).primaryClip
            val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)
            if (text.isNullOrBlank()) toast("클립보드가 비어 있어요")
            else b.urlInput.setText(YouTubeSaver.extractUrl(text.toString()))
        }
        b.cancelButton.setOnClickListener { DownloadService.cancel(this) }
        b.closePlayer.setOnClickListener {
            controller?.run { stop(); clearMediaItems() }
            syncPlayerUi()
        }

        b.playerView.setShowShuffleButton(true)
        b.playerView.setRepeatToggleModes(
            Player.REPEAT_MODE_ONE or Player.REPEAT_MODE_ALL
        )
        b.playerView.setFullscreenButtonClickListener { setFullscreen(it) }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (fullscreen) {
                    setFullscreen(false)
                } else {
                    // 뒤로가기로 앱을 닫아도 재생은 계속되도록 액티비티만 내린다
                    moveTaskToBack(true)
                }
            }
        })

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch { DownloadService.state.collect(::renderDownload) }
                launch {
                    DownloadService.events.collect { e ->
                        when (e) {
                            is DownloadService.Event.Saved -> {
                                toast("저장 완료: ${e.title}")
                                refreshList()
                            }
                            is DownloadService.Event.Failed -> toast(e.message)
                        }
                    }
                }
            }
        }

        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        handleShareIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShareIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        refreshList()
        val token = SessionToken(this, ComponentName(this, PlaybackService::class.java))
        val future = MediaController.Builder(this, token).buildAsync()
        controllerFuture = future
        future.addListener({
            val c = runCatching { future.get() }.getOrNull() ?: return@addListener
            controller = c
            c.addListener(playerListener)
            setVideoTrackEnabled(c, true)
            b.playerView.player = c
            syncPlayerUi()
        }, MoreExecutors.directExecutor())
    }

    override fun onStop() {
        // 화면이 안 보이는 동안은 영상 디코딩을 끄고 소리만 재생 (배터리 절약)
        controller?.let {
            setVideoTrackEnabled(it, false)
            it.removeListener(playerListener)
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

    private fun handleShareIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
        val url = YouTubeSaver.extractUrl(text) ?: return
        b.urlInput.setText(url)
        // 유튜브 앱의 "공유 → 이 앱"으로 들어오면 바로 저장 시작
        startSave(url)
        intent.action = null
    }

    private fun selectedQuality(): Quality =
        Quality.entries.firstOrNull { chipFor(it).isChecked } ?: Quality.P720

    private fun chipFor(q: Quality) = when (q) {
        Quality.P1080 -> b.chip1080
        Quality.P720 -> b.chip720
        Quality.P480 -> b.chip480
        Quality.P360 -> b.chip360
        Quality.AUDIO -> b.chipAudio
    }

    private fun startSave(input: String) {
        val url = YouTubeSaver.extractUrl(input)
        if (url == null) {
            toast("유튜브 링크를 입력해 주세요")
            return
        }
        try {
            YouTubeSaver.videoId(url)
        } catch (e: SaveException) {
            toast(e.message ?: "")
            return
        }
        val quality = selectedQuality()
        prefs.edit().putString("quality", quality.name).apply()
        DownloadService.start(this, url, quality)
        b.urlInput.setText("")
        getSystemService(InputMethodManager::class.java)
            .hideSoftInputFromWindow(b.urlInput.windowToken, 0)
        if (DownloadService.state.value is DownloadState.Running) toast("대기열에 추가했어요")
    }

    private fun renderDownload(state: DownloadState) {
        when (state) {
            DownloadState.Idle -> b.progressCard.isVisible = false
            is DownloadState.Running -> {
                b.progressCard.isVisible = true
                b.progressTitle.text = state.title
                val queued = if (state.queued > 0) " · 대기 ${state.queued}개" else ""
                if (state.total > 0) {
                    val percent = (state.done * 100 / state.total).toInt()
                    b.progressBar.isIndeterminate = false
                    b.progressBar.setProgressCompat(percent, true)
                    b.progressText.text =
                        "$percent% · ${formatSize(state.done)} / ${formatSize(state.total)}$queued"
                } else {
                    b.progressBar.isIndeterminate = true
                    b.progressText.text =
                        (if (state.done > 0) formatSize(state.done) else "준비 중…") + queued
                }
            }
        }
    }

    private fun refreshList() {
        videos = Library.list(this)
        adapter.submit(videos)
        b.emptyText.isVisible = videos.isEmpty()
        val total = videos.sumOf { it.sizeBytes }
        b.libraryHeader.text =
            if (videos.isEmpty()) "저장된 영상" else "저장된 영상 ${videos.size}개 · ${formatSize(total)}"
    }

    /** 누른 영상부터 보관함 전체를 재생목록으로 재생 */
    private fun play(video: SavedVideo) {
        val c = controller ?: return toast("플레이어 준비 중이에요. 잠시 후 다시 눌러 주세요")
        val start = videos.indexOfFirst { it.id == video.id }.coerceAtLeast(0)
        c.setMediaItems(videos.map { it.toMediaItem() }, start, 0L)
        c.prepare()
        c.play()
        syncPlayerUi()
    }

    private fun confirmDelete(video: SavedVideo) {
        MaterialAlertDialogBuilder(this)
            .setTitle("삭제할까요?")
            .setMessage("${video.title}\n(${formatSize(video.sizeBytes)})")
            .setNegativeButton("취소", null)
            .setPositiveButton("삭제") { _, _ ->
                controller?.let { c ->
                    for (i in c.mediaItemCount - 1 downTo 0) {
                        if (c.getMediaItemAt(i).mediaId == video.id) c.removeMediaItem(i)
                    }
                }
                Library.delete(video)
                refreshList()
                syncPlayerUi()
            }
            .show()
    }

    private fun syncPlayerUi() {
        val c = controller
        val active = c != null && c.mediaItemCount > 0
        if (!active && fullscreen) setFullscreen(false)
        b.playerView.isVisible = active
        b.nowPlayingBar.isVisible = active && !fullscreen
        val id = c?.currentMediaItem?.mediaId
        adapter.playingId = if (active) id else null
        val current = id?.let { Library.find(this, it) }
        b.nowPlaying.text = current?.title ?: ""
        // 소리만 저장한 항목은 썸네일을 크게 보여 준다
        b.playerView.defaultArtwork =
            current?.thumbFile?.let { Thumbs.get(it) }?.let { BitmapDrawable(resources, it) }
    }

    private fun setFullscreen(enable: Boolean) {
        fullscreen = enable
        b.contentArea.isVisible = !enable
        b.toolbar.isVisible = !enable
        b.nowPlayingBar.isVisible = !enable
        val lp = b.playerView.layoutParams as ConstraintLayout.LayoutParams
        if (enable) {
            lp.dimensionRatio = null
            lp.topToBottom = ConstraintLayout.LayoutParams.UNSET
            lp.topToTop = ConstraintLayout.LayoutParams.PARENT_ID
            lp.bottomToBottom = ConstraintLayout.LayoutParams.PARENT_ID
        } else {
            lp.dimensionRatio = "16:9"
            lp.topToTop = ConstraintLayout.LayoutParams.UNSET
            lp.topToBottom = R.id.toolbar
            lp.bottomToBottom = ConstraintLayout.LayoutParams.UNSET
        }
        b.playerView.layoutParams = lp
        b.playerView.setFullscreenButtonState(enable)

        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        if (enable) {
            insetsController.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            insetsController.hide(WindowInsetsCompat.Type.systemBars())
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        } else {
            insetsController.show(WindowInsetsCompat.Type.systemBars())
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
        ViewCompat.requestApplyInsets(b.root)
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}
