package com.joyong.ytsaver

import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import org.schabi.newpipe.extractor.services.youtube.YoutubeParsingHelper
import java.io.IOException
import kotlin.coroutines.coroutineContext

/** 검색 결과 한 개 */
data class SearchResult(
    val videoId: String,
    val title: String,
    val channel: String,
    val duration: String,
    val views: String,
    val published: String,
) {
    val url get() = "https://www.youtube.com/watch?v=$videoId"
    val thumbnailUrl get() = "https://i.ytimg.com/vi/$videoId/mqdefault.jpg"
}

/** 검색할 언어 (code가 빈 값이면 상관없음) */
enum class SearchLanguage(val code: String, val label: String) {
    ANY("", "언어 상관없음"),
    KO("ko", "한국어"),
    EN("en", "English (영어)"),
    JA("ja", "日本語 (일본어)"),
    ZH_CN("zh-CN", "中文简体 (중국어 간체)"),
    ZH_TW("zh-TW", "中文繁體 (중국어 번체)"),
    ES("es", "Español (스페인어)"),
    FR("fr", "Français (프랑스어)"),
    DE("de", "Deutsch (독일어)"),
    PT("pt", "Português (포르투갈어)"),
    IT("it", "Italiano (이탈리아어)"),
    RU("ru", "Русский (러시아어)"),
    VI("vi", "Tiếng Việt (베트남어)"),
    TH("th", "ไทย (태국어)"),
    ID("id", "Bahasa Indonesia (인도네시아어)"),
    TR("tr", "Türkçe (튀르키예어)"),
    AR("ar", "العربية (아랍어)"),
    HI("hi", "हिन्दी (힌디어)"),
}

/** 정렬. sp는 유튜브 내부 검색의 필터 값(동영상만 + 정렬), api는 Data API의 order 값 */
enum class SearchOrder(val label: String, val sp: String, val api: String) {
    RELEVANCE("관련성순", "EgIQAQ==", "relevance"),
    DATE("업로드 날짜순", "CAISAhAB", "date"),
    VIEWS("조회수순", "CAMSAhAB", "viewCount"),
    RATING("평점순", "CAESAhAB", "rating"),
}

data class SearchOptions(
    val keyword: String,
    val language: SearchLanguage,
    val count: Int,
    val order: SearchOrder,
    /** 키워드를 고른 언어로 번역해서 검색 */
    val translate: Boolean,
    /** 제목이 고른 언어인 영상만 */
    val strict: Boolean,
    /** 정렬을 무작위로 고르고, 후보를 넉넉히 모은 뒤 섞어서 고른다 */
    val random: Boolean,
    /** YouTube Data API 키 (비우면 키 없이 유튜브 내부 검색) */
    val apiKey: String,
)

/**
 * 키워드로 유튜브 영상 링크를 찾는다.
 * 키가 없으면 유튜브 웹이 쓰는 내부 검색(/youtubei/v1/search), 키가 있으면 YouTube Data API.
 */
object YouTubeSearch {

    private const val MAX_PAGES = 20
    private val JSON = "application/json".toMediaType()

    suspend fun search(options: SearchOptions, onStatus: (String) -> Unit): List<SearchResult> =
        withContext(Dispatchers.IO) {
            val lang = options.language
            var query = options.keyword.trim()
            if (query.isEmpty()) throw IOException("키워드를 입력하세요")

            if (options.translate && lang != SearchLanguage.ANY) {
                onStatus("키워드를 ${lang.label}로 번역 중…")
                runCatching { GoogleTranslator.translateText(query, lang.code) }
                    .onSuccess { if (it.isNotBlank()) query = it }
                    .onFailure { onStatus("번역에 실패해 원래 키워드로 검색해요") }
            }

            val order = if (options.random) SearchOrder.entries.random() else options.order
            val target = if (options.random) (options.count * 3).coerceAtMost(200) else options.count
            val found = LinkedHashMap<String, SearchResult>()
            var skipped = 0

            val useApi = options.apiKey.isNotBlank()
            var token: String? = null
            for (pageNo in 0 until MAX_PAGES) {
                coroutineContext.ensureActive()
                onStatus("“$query” ${order.label} 검색 중… ${found.size}개 찾음")
                val (raw, next) = if (useApi) {
                    dataApiRequest(query, lang, order, options.apiKey, token)
                } else {
                    innertubeRequest(query, lang, order, token)
                }
                val items = raw.filter { it.videoId !in found }
                val kept = if (options.strict && lang != SearchLanguage.ANY) {
                    filterByLanguage(items, lang)
                } else items
                skipped += items.size - kept.size
                kept.forEach { found[it.videoId] = it }
                if (found.size >= target) break
                token = next ?: break
            }

            val list = found.values.toList()
            val result = if (options.random) list.shuffled().take(options.count) else list.take(options.count)
            val note = buildString {
                append("“$query” · ${order.label} · ${result.size}개 찾음")
                if (skipped > 0) append(" (제목 언어가 달라 제외 ${skipped}개)")
                if (result.size < options.count) append(" · 키워드를 바꾸거나 '제목 언어' 옵션을 끄면 더 찾을 수 있어요")
            }
            onStatus(note)
            result
        }

    // ───────── 유튜브 내부 검색 (키 없음) ─────────

    private fun innertubeRequest(
        query: String,
        lang: SearchLanguage,
        order: SearchOrder,
        continuation: String?,
    ): Pair<List<SearchResult>, String?> {
        val version = runCatching { YoutubeParsingHelper.getClientVersion() }.getOrNull() ?: "2.20260805.01.00"
        val client = JSONObject()
            .put("clientName", "WEB")
            .put("clientVersion", version)
            .put("hl", lang.code.ifEmpty { "ko" })
            .put("gl", "KR")
        val body = JSONObject().put("context", JSONObject().put("client", client))
        if (continuation != null) body.put("continuation", continuation)
        else body.put("query", query).put("params", order.sp)

        val request = Request.Builder()
            .url("https://www.youtube.com/youtubei/v1/search?prettyPrint=false")
            .post(body.toString().toRequestBody(JSON))
            .header("User-Agent", NetDownloader.USER_AGENT)
            .header("X-YouTube-Client-Name", "1")
            .header("X-YouTube-Client-Version", version)
            .header("Origin", "https://www.youtube.com")
            .build()
        val json = App.http.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("유튜브 검색 HTTP ${resp.code}")
            JSONObject(resp.body?.string().orEmpty())
        }
        val items = ArrayList<SearchResult>()
        var token: String? = null
        walk(json) { key, value ->
            if (key == "videoRenderer" && value is JSONObject) parseVideoRenderer(value)?.let { items += it }
            if (key == "continuationCommand" && value is JSONObject) {
                value.optString("token").takeIf { it.isNotEmpty() }?.let { token = it }
            }
        }
        return items to token
    }

    /** JSON 전체를 돌며 키마다 콜백 (유튜브 응답 구조가 자주 바뀌어 위치 대신 이름으로 찾는다) */
    private fun walk(node: Any?, visit: (String, Any?) -> Unit) {
        when (node) {
            is JSONObject -> node.keys().forEach { key ->
                val value = node.opt(key)
                visit(key, value)
                if (key != "videoRenderer") walk(value, visit)
            }
            is JSONArray -> for (i in 0 until node.length()) walk(node.opt(i), visit)
        }
    }

    private fun text(obj: JSONObject?): String {
        if (obj == null) return ""
        obj.optString("simpleText").takeIf { it.isNotEmpty() }?.let { return it }
        val runs = obj.optJSONArray("runs") ?: return ""
        return (0 until runs.length()).joinToString("") { runs.optJSONObject(it)?.optString("text").orEmpty() }
    }

    private fun parseVideoRenderer(v: JSONObject): SearchResult? {
        val id = v.optString("videoId").takeIf { it.isNotEmpty() } ?: return null
        return SearchResult(
            videoId = id,
            title = text(v.optJSONObject("title")),
            channel = text(v.optJSONObject("ownerText")).ifEmpty { text(v.optJSONObject("longBylineText")) },
            duration = text(v.optJSONObject("lengthText")),
            views = text(v.optJSONObject("shortViewCountText")).ifEmpty { text(v.optJSONObject("viewCountText")) },
            published = text(v.optJSONObject("publishedTimeText")),
        )
    }

    // ───────── YouTube Data API (키 있음) ─────────

    private fun dataApiRequest(
        query: String,
        lang: SearchLanguage,
        order: SearchOrder,
        key: String,
        pageToken: String?,
    ): Pair<List<SearchResult>, String?> {
        val url = buildString {
            append("https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=50")
            append("&q=").append(Uri.encode(query))
            append("&order=").append(order.api)
            if (lang.code.isNotEmpty()) append("&relevanceLanguage=").append(lang.code.substringBefore('-'))
            pageToken?.let { append("&pageToken=").append(it) }
            append("&key=").append(Uri.encode(key.trim()))
        }
        val json = App.http.newCall(Request.Builder().url(url).build()).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) {
                val msg = runCatching { JSONObject(body).getJSONObject("error").optString("message") }.getOrNull()
                throw IOException("YouTube API 오류 (${resp.code}) ${msg.orEmpty()}")
            }
            JSONObject(body)
        }
        val arr = json.optJSONArray("items") ?: JSONArray()
        val items = (0 until arr.length()).mapNotNull { i ->
            val item = arr.optJSONObject(i) ?: return@mapNotNull null
            val id = item.optJSONObject("id")?.optString("videoId").orEmpty().ifEmpty { return@mapNotNull null }
            val snippet = item.optJSONObject("snippet") ?: JSONObject()
            SearchResult(
                videoId = id,
                title = unescapeHtml(snippet.optString("title")),
                channel = unescapeHtml(snippet.optString("channelTitle")),
                duration = "",
                views = "",
                published = snippet.optString("publishedAt").take(10),
            )
        }
        return items to json.optString("nextPageToken").takeIf { it.isNotEmpty() }
    }

    private fun unescapeHtml(s: String) = s.replace("&quot;", "\"").replace("&#39;", "'")
        .replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")

    // ───────── 제목 언어 확인 ─────────

    private val detectCache = HashMap<String, String?>()

    /** 글자 모양으로 바로 구별되는 언어는 그대로, 라틴 문자 언어는 구글 번역의 언어 감지로 확인 */
    private suspend fun filterByLanguage(items: List<SearchResult>, lang: SearchLanguage): List<SearchResult> {
        val code = lang.code.substringBefore('-')
        val script = scriptCheck(code)
        if (script != null) return items.filter { script(it.title) }
        val limit = Semaphore(6)
        return coroutineScope {
            items.map { item ->
                async {
                    limit.withPermit {
                        val detected = synchronized(detectCache) { detectCache[item.title] }
                            ?: GoogleTranslator.detectLanguage(item.title).also {
                                synchronized(detectCache) { detectCache[item.title] = it }
                            }
                        item.takeIf { detected?.substringBefore('-') == code }
                    }
                }
            }.awaitAll().filterNotNull()
        }
    }

    private fun scriptCheck(code: String): ((String) -> Boolean)? {
        fun has(r: Regex) = { t: String -> r.containsMatchIn(t) }
        return when (code) {
            "ko" -> has(Regex("[가-힣]"))
            "ja" -> has(Regex("[\\u3040-\\u30ff]"))
            "zh" -> { t: String -> Regex("[\\u4e00-\\u9fff]").containsMatchIn(t) &&
                !Regex("[\\u3040-\\u30ff가-힣]").containsMatchIn(t) }
            "ru" -> has(Regex("[\\u0400-\\u04ff]"))
            "ar" -> has(Regex("[\\u0600-\\u06ff]"))
            "hi" -> has(Regex("[\\u0900-\\u097f]"))
            "th" -> has(Regex("[\\u0e00-\\u0e7f]"))
            else -> null
        }
    }
}
