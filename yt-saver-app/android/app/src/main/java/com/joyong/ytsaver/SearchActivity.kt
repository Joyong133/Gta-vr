package com.joyong.ytsaver

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.LruCache
import android.view.LayoutInflater
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.ArrayAdapter
import android.widget.ImageView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.core.view.updatePadding
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.chip.Chip
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.joyong.ytsaver.databinding.ActivitySearchBinding
import com.joyong.ytsaver.databinding.ItemSearchBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Request

/**
 * 키워드로 유튜브 영상을 찾아 바로 저장하는 화면.
 * 잠금화면에서 열면(EXTRA_FROM_LOCK) 잠금 화면 위에 뜬다.
 */
class SearchActivity : AppCompatActivity() {

    private lateinit var b: ActivitySearchBinding
    private lateinit var adapter: SearchAdapter
    private var job: Job? = null
    private var results: List<SearchResult> = emptyList()
    private val prefs by lazy { getSharedPreferences("search", MODE_PRIVATE) }
    private val fromLock by lazy { intent.getBooleanExtra(EXTRA_FROM_LOCK, false) }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (fromLock) showOverLockScreen()
        b = ActivitySearchBinding.inflate(layoutInflater)
        setContentView(b.root)
        ViewCompat.setOnApplyWindowInsetsListener(b.root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.updatePadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        b.toolbar.setNavigationOnClickListener { finish() }

        b.language.adapter = ArrayAdapter(
            this, android.R.layout.simple_spinner_dropdown_item, SearchLanguage.entries.map { it.label }
        )
        SearchOrder.entries.forEachIndexed { i, order ->
            val chip = layoutInflater.inflate(R.layout.chip_filter, b.orderGroup, false) as Chip
            chip.id = 2000 + i
            chip.text = order.label
            b.orderGroup.addView(chip)
        }
        loadPrefs()

        b.advancedToggle.setOnClickListener {
            b.apiKeyLayout.isVisible = !b.apiKeyLayout.isVisible
            b.advancedToggle.text = if (b.apiKeyLayout.isVisible) "고급 설정 ▴" else "고급 설정 ▾"
        }
        b.keyword.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_SEARCH) { startOrStop(); true } else false
        }
        b.searchButton.setOnClickListener { startOrStop() }

        adapter = SearchAdapter(
            onClick = ::showResultMenu,
            onLongClick = { copy(listOf(it)) },
            onSave = { save(listOf(it)) },
        )
        b.results.layoutManager = LinearLayoutManager(this)
        b.results.adapter = adapter

        b.copyAll.setOnClickListener { copy(results) }
        b.saveAll.setOnClickListener {
            MaterialAlertDialogBuilder(this)
                .setTitle("${results.size}개를 모두 저장할까요?")
                .setMessage("저장 화면의 화질·자막·소리 언어 설정으로 차례대로 받아요.")
                .setNegativeButton("취소", null)
                .setPositiveButton("모두 저장") { _, _ -> save(results) }
                .show()
        }

        intent.getStringExtra(EXTRA_KEYWORD)?.let { b.keyword.setText(it) }
    }

    @Suppress("DEPRECATION")
    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= 27) setShowWhenLocked(true)
        else window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
    }

    private fun loadPrefs() {
        b.keyword.setText(prefs.getString("keyword", ""))
        val lang = runCatching { SearchLanguage.valueOf(prefs.getString("language", "ANY")!!) }
            .getOrDefault(SearchLanguage.ANY)
        b.language.setSelection(SearchLanguage.entries.indexOf(lang))
        b.count.setText(prefs.getInt("count", 20).toString())
        val order = runCatching { SearchOrder.valueOf(prefs.getString("order", "RELEVANCE")!!) }
            .getOrDefault(SearchOrder.RELEVANCE)
        b.orderGroup.check(2000 + SearchOrder.entries.indexOf(order))
        b.translate.isChecked = prefs.getBoolean("translate", true)
        b.strict.isChecked = prefs.getBoolean("strict", false)
        b.random.isChecked = prefs.getBoolean("random", false)
        b.apiKey.setText(prefs.getString("api_key", ""))
    }

    private fun options(): SearchOptions {
        val order = SearchOrder.entries.getOrElse(b.orderGroup.checkedChipId - 2000) { SearchOrder.RELEVANCE }
        val options = SearchOptions(
            keyword = b.keyword.text?.toString().orEmpty(),
            language = SearchLanguage.entries[b.language.selectedItemPosition.coerceAtLeast(0)],
            count = (b.count.text?.toString()?.toIntOrNull() ?: 20).coerceIn(1, 200),
            order = order,
            translate = b.translate.isChecked,
            strict = b.strict.isChecked,
            random = b.random.isChecked,
            apiKey = b.apiKey.text?.toString().orEmpty().trim(),
        )
        prefs.edit()
            .putString("keyword", options.keyword)
            .putString("language", options.language.name)
            .putInt("count", options.count)
            .putString("order", order.name)
            .putBoolean("translate", options.translate)
            .putBoolean("strict", options.strict)
            .putBoolean("random", options.random)
            .putString("api_key", options.apiKey)
            .apply()
        return options
    }

    private fun startOrStop() {
        job?.let {
            it.cancel()
            return
        }
        val options = options()
        if (options.keyword.isBlank()) {
            toast("키워드를 입력하세요")
            return
        }
        getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(b.keyword.windowToken, 0)
        b.searchButton.text = "멈추기"
        b.status.text = "검색 중…"
        job = lifecycleScope.launch {
            try {
                results = YouTubeSearch.search(options) { msg ->
                    lifecycleScope.launch { b.status.text = msg }
                }
                adapter.submit(results)
                b.actions.isVisible = results.isNotEmpty()
                if (results.isNotEmpty()) toast("${results.size}개 찾았어요. 누르면 메뉴, 길게 누르면 링크 복사")
            } catch (e: kotlinx.coroutines.CancellationException) {
                b.status.text = "멈췄어요"
            } catch (e: Exception) {
                b.status.text = "검색 실패: ${YouTubeSaver.describe(e)}"
            } finally {
                job = null
                b.searchButton.text = "찾기"
            }
        }
    }

    private fun showResultMenu(r: SearchResult) {
        val saved = Library.find(this, r.videoId) != null
        val options = arrayOf(
            if (saved) "이미 저장됨" else "저장하기",
            "유튜브 앱에서 열기",
            "링크 복사",
        )
        MaterialAlertDialogBuilder(this)
            .setTitle(r.title)
            .setItems(options) { _, which ->
                when (which) {
                    0 -> if (!saved) save(listOf(r))
                    1 -> open(r)
                    2 -> copy(listOf(r))
                }
            }
            .show()
    }

    private fun save(items: List<SearchResult>) {
        val todo = items.filter { Library.find(this, it.videoId) == null }
        todo.forEach { DownloadService.startWithSavedSettings(this, it.url) }
        toast(
            when {
                todo.isEmpty() -> "이미 모두 저장된 영상이에요"
                todo.size == 1 -> "저장을 시작했어요"
                else -> "${todo.size}개를 저장 대기열에 넣었어요"
            }
        )
    }

    private fun open(r: SearchResult) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(r.url)))
        } catch (e: Exception) {
            copy(listOf(r))
            toast("열 수 있는 앱이 없어 링크를 복사했어요")
        }
    }

    private fun copy(items: List<SearchResult>) {
        if (items.isEmpty()) return
        getSystemService(ClipboardManager::class.java)
            .setPrimaryClip(ClipData.newPlainText("유튜브 링크", items.joinToString("\n") { it.url }))
        toast(if (items.size == 1) "링크를 복사했어요" else "${items.size}개 링크를 복사했어요")
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    private inner class SearchAdapter(
        private val onClick: (SearchResult) -> Unit,
        private val onLongClick: (SearchResult) -> Unit,
        private val onSave: (SearchResult) -> Unit,
    ) : RecyclerView.Adapter<SearchAdapter.Holder>() {

        private var items: List<SearchResult> = emptyList()

        fun submit(list: List<SearchResult>) {
            items = list
            notifyDataSetChanged()
        }

        override fun getItemCount() = items.size

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
            Holder(ItemSearchBinding.inflate(LayoutInflater.from(parent.context), parent, false))

        override fun onBindViewHolder(holder: Holder, position: Int) {
            val r = items[position]
            with(holder.b) {
                title.text = r.title
                subtitle.text = listOf(r.channel, r.views, r.published).filter { it.isNotBlank() }.joinToString(" · ")
                duration.text = r.duration
                duration.isVisible = r.duration.isNotBlank()
                val saved = Library.find(this@SearchActivity, r.videoId) != null
                save.text = if (saved) "저장됨" else "저장"
                save.isEnabled = !saved
                save.setOnClickListener { onSave(r); save.text = "대기"; save.isEnabled = false }
                root.setOnClickListener { onClick(r) }
                root.setOnLongClickListener { onLongClick(r); true }
                loadThumb(thumb, r.thumbnailUrl)
            }
        }

        inner class Holder(val b: ItemSearchBinding) : RecyclerView.ViewHolder(b.root)
    }

    private fun loadThumb(view: ImageView, url: String) {
        view.tag = url
        thumbCache.get(url)?.let { view.setImageBitmap(it); return }
        view.setImageDrawable(null)
        lifecycleScope.launch {
            val bitmap = withContext(Dispatchers.IO) {
                runCatching {
                    App.http.newCall(Request.Builder().url(url).build()).execute().use { resp ->
                        resp.body?.bytes()?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
                    }
                }.getOrNull()
            } ?: return@launch
            thumbCache.put(url, bitmap)
            if (view.tag == url) view.setImageBitmap(bitmap)
        }
    }

    companion object {
        const val EXTRA_FROM_LOCK = "from_lock"
        const val EXTRA_KEYWORD = "keyword"
        private val thumbCache = LruCache<String, Bitmap>(80)

        fun open(context: Context, fromLock: Boolean = false) {
            context.startActivity(
                Intent(context, SearchActivity::class.java).putExtra(EXTRA_FROM_LOCK, fromLock)
            )
        }
    }
}
