package com.joyong.ytsaver

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.graphics.drawable.BitmapDrawable
import android.os.Build
import android.os.Bundle
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.view.WindowManager
import android.text.InputType
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import com.google.android.material.materialswitch.MaterialSwitch
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
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
import com.google.android.material.snackbar.Snackbar
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import com.joyong.ytsaver.databinding.ActivityMainBinding
import kotlinx.coroutines.launch

@OptIn(UnstableApi::class)
class MainActivity : AppCompatActivity() {

    private lateinit var b: ActivityMainBinding
    private lateinit var adapter: VideoAdapter
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var bgControllerFuture: ListenableFuture<MediaController>? = null
    private var bgController: MediaController? = null

    private val bgListener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) = syncBgUi()
    }
    private var controller: MediaController? = null
    private var fullscreen = false

    /** 잠금 화면 위에 떠 있는 상태 (저장·삭제·설정을 숨김) */
    private var locked = false
    private val unlockReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = updateLockedUi()
    }
    private var videos: List<SavedVideo> = emptyList()

    private val prefs by lazy { getSharedPreferences("settings", MODE_PRIVATE) }

    private val captcha = registerForActivityResult(CaptchaActivity.Contract()) { passed ->
        if (passed) {
            if (!DownloadService.retryLast(this)) toast("확인 완료! 다시 저장해 보세요")
        } else {
            toast("로봇 확인을 마치지 못했어요")
        }
    }

    private val login = registerForActivityResult(LoginActivity.Contract()) { ok ->
        updateAccountUi()
        if (ok && !DownloadService.retryLast(this)) toast("로그인했어요. 다시 저장해 보세요")
    }

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    private val playerListener = object : Player.Listener {
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            syncPlayerUi()
            refreshList()
        }

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

        updateAccountUi()
        b.toolbar.setOnMenuItemClickListener { item ->
            if (item.itemId == MENU_LOCK) {
                val on = !lockScreenEnabled()
                prefs.edit().putBoolean("lock_screen", on).apply()
                applyShowWhenLocked()
                updateAccountUi()
                toast(
                    if (on) "켰어요: 재생 중에 화면을 끄면, 다시 켤 때 잠금 해제 없이 이 화면이 먼저 나와요"
                    else "잠금화면에서 바로 보기를 껐어요"
                )
                return@setOnMenuItemClickListener true
            }
            if (item.itemId == MENU_FOCUS) {
                val on = !WatchHistory.focusMode(this)
                prefs.edit().putBoolean("focus_mode", on).apply()
                updateAccountUi()
                toast(
                    if (on) "집중 모드 켬: 이미 본 부분까지만 이동할 수 있어요"
                    else "집중 모드 끔"
                )
                return@setOnMenuItemClickListener true
            }
            if (item.itemId == MENU_AI) {
                showAiSettings()
                return@setOnMenuItemClickListener true
            }
            if (YouTubeAccount.isLoggedIn(this)) {
                MaterialAlertDialogBuilder(this)
                    .setTitle("유튜브 로그아웃할까요?")
                    .setNegativeButton("취소", null)
                    .setPositiveButton("로그아웃") { _, _ ->
                        YouTubeAccount.logout(this)
                        updateAccountUi()
                    }
                    .show()
            } else {
                askLogin()
            }
            true
        }

        adapter = VideoAdapter(
            onClick = ::play,
            onLongClick = ::showItemMenu,
            historyOf = { WatchHistory.get(this, it) },
        )
        b.list.layoutManager = LinearLayoutManager(this)
        b.list.adapter = adapter

        val savedQuality = prefs.getString("quality", Quality.P720.name)
        Quality.entries.forEach { q ->
            chipFor(q).isChecked = q.name == savedQuality
        }

        updateAudioLanguageButton()
        b.audioLangButton.setOnClickListener {
            val all = AudioLanguage.entries
            MaterialAlertDialogBuilder(this)
                .setTitle("저장할 소리 언어")
                .setSingleChoiceItems(
                    all.map { if (it == AudioLanguage.ORIGINAL) "원래 언어 (기본)" else "${it.label} (더빙 있으면)" }
                        .toTypedArray(),
                    all.indexOf(audioLanguage()),
                ) { d, which ->
                    prefs.edit().putString("audio_lang", all[which].name).apply()
                    updateAudioLanguageButton()
                    d.dismiss()
                }
                .show()
        }

        b.subtitleSwitch.isChecked = prefs.getBoolean("subtitles", true)
        b.subtitleSwitch.setOnCheckedChangeListener { _, checked ->
            prefs.edit().putBoolean("subtitles", checked).apply()
        }

        b.sortGroup.check(if (prefs.getBoolean("sort_recent", false)) R.id.sortRecent else R.id.sortSaved)
        b.sortGroup.addOnButtonCheckedListener { _, id, checked ->
            if (!checked) return@addOnButtonCheckedListener
            prefs.edit().putBoolean("sort_recent", id == R.id.sortRecent).apply()
            refreshList()
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
            WatchHistory.clearSession(this)
            syncPlayerUi()
        }

        b.playerView.setShowShuffleButton(true)
        b.playerView.setRepeatToggleModes(
            Player.REPEAT_MODE_ONE or Player.REPEAT_MODE_ALL
        )
        b.playerView.setFullscreenButtonClickListener { setFullscreen(it) }

        b.bgPlayPause.setOnClickListener {
            bgController?.let { if (it.isPlaying) it.pause() else it.play() }
        }
        b.bgRepeat.setOnClickListener {
            bgController?.let {
                it.repeatMode = if (it.repeatMode == Player.REPEAT_MODE_ONE) Player.REPEAT_MODE_OFF
                else Player.REPEAT_MODE_ONE
            }
        }
        b.bgClose.setOnClickListener {
            bgController?.run { stop(); clearMediaItems() }
        }
        b.bgVolume.addOnChangeListener { _, value, fromUser ->
            if (fromUser) {
                bgController?.volume = value
                prefs.edit().putFloat("bg_volume", value).apply()
            }
        }
        b.mainVolume.addOnChangeListener { _, value, fromUser ->
            if (fromUser) controller?.volume = value
        }

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
                                toast("${e.note}: ${e.title}")
                                refreshList()
                            }
                            DownloadService.Event.Cancelled -> toast("저장을 취소했어요")
                        }
                    }
                }
                launch {
                    DownloadService.failure.collect { f -> if (f != null) showFailure(f) }
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
            restoreLastSession(c)
            syncPlayerUi()
        }, MoreExecutors.directExecutor())

        // 배경 소리 플레이어는 같은 서비스의 두 번째 세션에 연결
        val bgFuture = MediaController.Builder(this, token)
            .setConnectionHints(Bundle().apply {
                putString(PlaybackService.HINT_SESSION, PlaybackService.BG_SESSION_ID)
            })
            .buildAsync()
        bgControllerFuture = bgFuture
        bgFuture.addListener({
            val c = runCatching { bgFuture.get() }.getOrNull() ?: return@addListener
            bgController = c
            c.addListener(bgListener)
            syncBgUi()
        }, MoreExecutors.directExecutor())
    }

    override fun onResume() {
        super.onResume()
        ContextCompat.registerReceiver(
            this, unlockReceiver, IntentFilter(Intent.ACTION_USER_PRESENT),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        updateLockedUi()
    }

    override fun onPause() {
        runCatching { unregisterReceiver(unlockReceiver) }
        super.onPause()
    }

    private fun lockScreenEnabled() = prefs.getBoolean("lock_screen", true)

    /** 재생 중이고 설정이 켜져 있으면 잠금 화면 위에 이 화면을 띄운다 */
    private fun applyShowWhenLocked() {
        val playing = (controller?.mediaItemCount ?: 0) > 0
        val show = lockScreenEnabled() && playing
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(show)
        } else {
            @Suppress("DEPRECATION")
            if (show) window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
        }
    }

    /** 잠금 화면 위에서는 재생·목록만, 잠금을 풀면 전체 기능 */
    private fun updateLockedUi() {
        locked = getSystemService(KeyguardManager::class.java).isKeyguardLocked
        b.saveCard.isVisible = !locked && !fullscreen
        updateAccountUi()
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
        bgController?.removeListener(bgListener)
        bgController = null
        bgControllerFuture?.let { MediaController.releaseFuture(it) }
        bgControllerFuture = null
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
        DownloadService.start(this, url, quality, b.subtitleSwitch.isChecked, audioLanguage())
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
                if (state.status != null) {
                    b.progressBar.isIndeterminate = true
                    b.progressText.text = state.status + queued
                } else if (state.total > 0) {
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
        val all = Library.list(this)
        videos = if (b.sortGroup.checkedButtonId == R.id.sortRecent) {
            // 본 적 있는 영상을 최근 본 순서로, 안 본 영상은 그 뒤에 저장순으로
            val watchedAt = all.associate { it.id to (WatchHistory.get(this, it.id)?.watchedAt ?: 0L) }
            all.sortedWith(compareByDescending<SavedVideo> { watchedAt[it.id] }.thenByDescending { it.savedAt })
        } else {
            all
        }
        adapter.submit(videos)
        b.emptyText.isVisible = videos.isEmpty()
        val total = videos.sumOf { it.sizeBytes }
        b.libraryHeader.text =
            if (videos.isEmpty()) "저장된 영상" else "저장된 영상 ${videos.size}개 · ${formatSize(total)}"
    }

    /** 누른 영상부터 보관함 전체를 재생목록으로 재생. 보던 영상이면 이어서 */
    private fun play(video: SavedVideo) {
        val c = controller ?: return toast("플레이어 준비 중이에요. 잠시 후 다시 눌러 주세요")
        if (c.currentMediaItem?.mediaId == video.id && c.playbackState != Player.STATE_ENDED) {
            if (c.playbackState == Player.STATE_IDLE) c.prepare()
            c.play()
            return
        }
        val start = videos.indexOfFirst { it.id == video.id }.coerceAtLeast(0)
        val resume = WatchHistory.resumePosition(this, video.id)
        c.setMediaItems(videos.map { it.toMediaItem() }, start, resume)
        c.prepare()
        c.play()
        syncPlayerUi()
        if (resume > 0) {
            Snackbar.make(b.root, "${formatDuration(resume / 1000)}부터 이어서 재생해요", Snackbar.LENGTH_LONG)
                .setAction("처음부터") { controller?.seekTo(0) }
                .show()
        }
    }

    /** 앱이 완전히 종료됐다가 다시 켜졌을 때 마지막으로 보던 영상을 그 위치에 (일시정지 상태로) */
    private fun restoreLastSession(c: MediaController) {
        if (c.mediaItemCount > 0) return
        val (list, index, position) = WatchHistory.restore(this) ?: return
        c.setMediaItems(list.map { it.toMediaItem() }, index, position)
        c.prepare()
    }

    private fun showItemMenu(video: SavedVideo) {
        if (locked) {
            toast("잠금을 풀면 메뉴를 쓸 수 있어요")
            return
        }
        val hasSubs = video.subKo != null
        val options = arrayOf(
            "🎧 배경 소리로 같이 듣기 (화면 없이 소리만)",
            if (hasSubs) "한국어 자막 다시 받기" else "한국어 자막 받기 (구글 번역)",
            "🌐 구글 번역으로 한국어 자막 다시 만들기",
            "시청 기록 지우기",
            "삭제",
            "🤖 Claude(유료)로 다시 번역",
        )
        MaterialAlertDialogBuilder(this)
            .setTitle(video.title)
            .setItems(options) { _, which ->
                when (which) {
                    0 -> playInBackground(video)
                    1 -> {
                        DownloadService.addSubtitles(this, video.id)
                        toast("자막을 받는 중이에요 (인터넷 필요)")
                    }
                    2 -> retranslate(video, useClaude = false)
                    3 -> {
                        WatchHistory.remove(this, video.id)
                        refreshList()
                    }
                    4 -> confirmDelete(video)
                    5 -> retranslate(video, useClaude = true)
                }
            }
            .show()
    }

    /** 지금 보는 영상은 그대로 두고, 이 항목의 소리를 동시에 재생 */
    private fun playInBackground(video: SavedVideo) {
        val c = bgController ?: return toast("플레이어 준비 중이에요. 잠시 후 다시 눌러 주세요")
        c.setMediaItem(video.toMediaItem())
        c.volume = prefs.getFloat("bg_volume", 0.5f)
        c.prepare()
        c.play()
        syncBgUi()
        toast("배경 소리로 재생해요. 아래 막대에서 소리 크기를 조절하세요")
    }

    private fun syncBgUi() {
        val c = bgController
        val active = c != null && c.mediaItemCount > 0
        b.bgCard.isVisible = active
        if (!active) return
        c!!
        b.bgTitle.text = c.mediaMetadata.title ?: c.currentMediaItem?.mediaId?.let {
            Library.find(this, it)?.title
        } ?: "배경 소리"
        b.bgPlayPause.setImageResource(
            if (c.playWhenReady) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        )
        b.bgRepeat.alpha = if (c.repeatMode == Player.REPEAT_MODE_ONE) 1f else 0.35f
        b.bgVolume.value = c.volume.coerceIn(0f, 1f)
        val main = controller
        b.mainVolumeRow.isVisible = main != null && main.mediaItemCount > 0
        main?.let { b.mainVolume.value = it.volume.coerceIn(0f, 1f) }
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
                bgController?.let { c ->
                    if (c.currentMediaItem?.mediaId == video.id) { c.stop(); c.clearMediaItems() }
                }
                Library.delete(video)
                WatchHistory.remove(this, video.id)
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
        applyShowWhenLocked()
        val id = c?.currentMediaItem?.mediaId
        adapter.playingId = if (active) id else null
        syncBgUi()
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

    private fun showFailure(f: DownloadService.Failure) {
        DownloadService.clearFailure()
        val dialog = MaterialAlertDialogBuilder(this)
            .setTitle(f.title)
            .setMessage("${f.message}\n\n[자세한 오류]\n${f.detail}")
            .setNegativeButton("닫기", null)
            .setNeutralButton("오류 복사") { _, _ ->
                getSystemService(ClipboardManager::class.java)
                    .setPrimaryClip(ClipData.newPlainText("오류", "${f.message}\n${f.detail}"))
                toast("오류 내용을 복사했어요")
            }
        if (f.captchaUrl != null) {
            dialog.setPositiveButton("로봇 확인하기") { _, _ -> captcha.launch(f.captchaUrl) }
        } else if (f.needsLogin) {
            dialog.setPositiveButton("유튜브 로그인") { _, _ -> askLogin() }
        } else {
            dialog.setPositiveButton("다시 시도") { _, _ -> DownloadService.retryLast(this) }
        }
        dialog.show()
    }

    private fun retranslate(video: SavedVideo, useClaude: Boolean) {
        if (useClaude && !AiSettings.isReady(this)) {
            toast("Claude는 API 키를 넣고 켜야 써요 (사용한 만큼 유료)")
            showAiSettings()
            return
        }
        if (video.subOrig != null) {
            // 저장된 원어 자막을 다시 번역 (유튜브 접속 없이)
            DownloadService.retranslate(this, video.id, useClaude)
            toast(if (useClaude) "Claude로 번역하는 중이에요" else "구글 번역으로 번역하는 중이에요")
        } else {
            // 원어 자막이 없으면 유튜브에서 받아 오면서 번역
            DownloadService.addSubtitles(this, video.id)
            toast("자막을 받아 번역하는 중이에요 (인터넷 필요)")
        }
    }

    /** Claude API 키·모델 설정 */
    private fun showAiSettings() {
        val pad = (20 * resources.displayMetrics.density).toInt()
        val keyLayout = TextInputLayout(this).apply {
            hint = "Claude API 키 (sk-ant-…)"
            endIconMode = TextInputLayout.END_ICON_PASSWORD_TOGGLE
        }
        val keyInput = TextInputEditText(keyLayout.context).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setText(AiSettings.apiKey(this@MainActivity))
        }
        keyLayout.addView(keyInput)
        val models = RadioGroup(this)
        AiSettings.Model.entries.forEachIndexed { i, m ->
            models.addView(RadioButton(this).apply {
                id = 1000 + i
                text = m.label
                isChecked = m == AiSettings.model(this@MainActivity)
            })
        }
        val enabled = MaterialSwitch(this).apply {
            text = "새로 저장할 때 Claude로 번역 (끄면 무료 구글 번역)"
            isChecked = AiSettings.enabled(this@MainActivity)
        }
        val help = TextView(this).apply {
            text = "기본 번역은 무료 구글 번역이에요. 이 설정은 돈을 내고 더 자연스러운 번역을 원할 때만 켜세요. " +
                "켜 두면 한국어 자막이 없는 영상을 저장할 때 Claude가 앞뒤 문맥을 보고 번역하고, " +
                "실패하면 구글 번역으로 넘어가요.\n\n" +
                "• API 키는 console.anthropic.com 에서 만들 수 있고, 사용한 만큼 요금이 나가요 " +
                "(10분 영상 기준 Opus 몇십 원~백몇십 원, Haiku는 몇 원 수준)\n" +
                "• 키는 이 폰의 앱 저장소에만 보관돼요"
            setPadding(0, pad / 2, 0, 0)
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad / 2, pad, 0)
            addView(keyLayout)
            addView(models)
            addView(enabled)
            addView(help)
        }
        MaterialAlertDialogBuilder(this)
            .setTitle("AI 자막 번역 (Claude)")
            .setView(ScrollView(this).apply { addView(content) })
            .setNegativeButton("취소", null)
            .setPositiveButton("저장") { _, _ ->
                val model = AiSettings.Model.entries
                    .getOrElse(models.checkedRadioButtonId - 1000) { AiSettings.Model.OPUS }
                AiSettings.save(this, keyInput.text?.toString().orEmpty(), model, enabled.isChecked)
                toast(if (AiSettings.isReady(this)) "AI 번역을 켰어요 (${model.label.substringBefore(" (")})" else "AI 번역이 꺼져 있어요")
            }
            .show()
    }

    private fun audioLanguage(): AudioLanguage =
        runCatching { AudioLanguage.valueOf(prefs.getString("audio_lang", "ORIGINAL")!!) }
            .getOrDefault(AudioLanguage.ORIGINAL)

    private fun updateAudioLanguageButton() {
        b.audioLangButton.text = "소리 언어: ${audioLanguage().label}"
    }

    private fun askLogin() {
        MaterialAlertDialogBuilder(this)
            .setTitle("유튜브 로그인")
            .setMessage(
                "유튜브가 지금 인터넷(IP)에서 로그인 없는 요청을 막고 있어요. " +
                    "로그인한 계정으로 요청하면 통과되는 경우가 많아요.\n\n" +
                    "• 다운로드에 쓰는 계정은 구글이 제한할 수 있어서 부계정을 권장해요\n" +
                    "• 비밀번호는 앱이 저장하지 않고, 로그인 후 유튜브 쿠키만 이 폰에 저장해요\n" +
                    "• 구글이 \"안전하지 않은 브라우저\"라며 막으면 이 방법은 쓸 수 없어요"
            )
            .setNegativeButton("취소", null)
            .setPositiveButton("로그인하기") { _, _ -> login.launch(Unit) }
            .show()
    }

    private fun updateAccountUi() {
        val loggedIn = YouTubeAccount.isLoggedIn(this)
        if (locked) {
            b.toolbar.subtitle = "🔒 잠금 화면 · 잠금을 풀면 저장·설정을 쓸 수 있어요"
            b.toolbar.menu.clear()
            return
        }
        val focus = WatchHistory.focusMode(this)
        b.toolbar.subtitle = "v${App.versionName}" +
            (if (loggedIn) " · 유튜브 로그인됨" else "") +
            (if (focus) " · 🎯 집중 모드" else "")
        // 집중 모드에서는 빨리 감기 버튼을 숨긴다 (막대를 앞으로 끌어도 본 곳까지만 이동)
        b.playerView.setShowFastForwardButton(!focus)
        b.toolbar.menu.clear()
        b.toolbar.menu.add(0, MENU_LOGIN, 0, if (loggedIn) "로그아웃" else "유튜브 로그인")
            .setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_ALWAYS)
        b.toolbar.menu.add(0, MENU_FOCUS, 1, "🎯 집중 모드 (앞으로 건너뛰기 막기)")
            .setCheckable(true)
            .setChecked(focus)
            .setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_NEVER)
        b.toolbar.menu.add(0, MENU_LOCK, 2, "🔓 잠금화면에서 바로 보기")
            .setCheckable(true)
            .setChecked(lockScreenEnabled())
            .setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_NEVER)
        b.toolbar.menu.add(0, MENU_AI, 3, "Claude 번역 설정 (유료, 선택)")
            .setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_NEVER)
    }

    companion object {
        private const val MENU_LOGIN = 1
        private const val MENU_AI = 2
        private const val MENU_FOCUS = 3
        private const val MENU_LOCK = 4
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}
