package com.joyong.ytsaver

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.exceptions.AgeRestrictedContentException
import org.schabi.newpipe.extractor.exceptions.ContentNotAvailableException
import org.schabi.newpipe.extractor.exceptions.GeographicRestrictionException
import org.schabi.newpipe.extractor.exceptions.PaidContentException
import org.schabi.newpipe.extractor.exceptions.PrivateContentException
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.exceptions.SignInConfirmNotBotException
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.UnknownHostException
import kotlin.coroutines.coroutineContext

/** 저장할 소리 언어. code가 빈 값이면 영상의 원래 언어 */
enum class AudioLanguage(val code: String, val label: String) {
    ORIGINAL("", "원래 언어"),
    KO("ko", "한국어"),
    EN("en", "영어"),
    JA("ja", "일본어"),
    ZH("zh", "중국어"),
    ES("es", "스페인어"),
    FR("fr", "프랑스어"),
    DE("de", "독일어"),
    PT("pt", "포르투갈어"),
    ID("id", "인도네시아어"),
    HI("hi", "힌디어"),
}

enum class Quality(val label: String, val maxHeight: Int) {
    P1080("1080p", 1080),
    P720("720p", 720),
    P480("480p", 480),
    P360("360p", 360),
    AUDIO("소리만", 0),
}

class SaveException(message: String, cause: Throwable? = null) : Exception(message, cause)

/** 유튜브 링크에서 스트림을 골라 기기에 저장한다. */
object YouTubeSaver {

    private const val CHUNK = 8L * 1024 * 1024
    private val URL_REGEX = Regex("""https?://\S+""")

    data class Progress(
        val title: String,
        val done: Long,
        val total: Long,
        val status: String? = null,
    )

    /** 공유 문구("제목 https://youtu.be/…")에서도 링크만 뽑아낸다. */
    fun extractUrl(text: String): String? =
        URL_REGEX.find(text.trim())?.value ?: text.trim().takeIf { it.isNotEmpty() }

    fun videoId(url: String): String = try {
        ServiceList.YouTube.streamLHFactory.getId(url)
    } catch (e: Exception) {
        throw SaveException("유튜브 영상 링크가 아니에요")
    }

    suspend fun save(
        context: Context,
        url: String,
        quality: Quality,
        withSubtitles: Boolean,
        audioLanguage: AudioLanguage,
        onProgress: (Progress) -> Unit,
    ): SavedVideo = withContext(Dispatchers.IO) {
        val id = videoId(url)
        Library.find(context, id)?.let { throw SaveException("이미 저장된 영상이에요: ${it.title}") }

        val info = fetchInfo(id)
        val title = info.title
        onProgress(Progress(title, 0, 0))

        val wanted = pickAudio(info.streams, audioLanguage.code)
        val audio = wanted ?: pickAudio(info.streams, "")
        // 고른 언어 소리를 쓰려면 소리가 섞인 영상 대신 화면만 있는 영상 + 그 소리를 받아야 한다
        val dubbed = wanted != null && audioLanguage != AudioLanguage.ORIGINAL && !wanted.originalAudio
        val video = if (quality == Quality.AUDIO) null
        else pickVideo(info.streams, quality.maxHeight, requireVideoOnly = dubbed)
            ?: pickVideo(info.streams, quality.maxHeight)
        // 소리가 포함된 일반 영상 스트림을 골랐다면 별도 오디오 파일은 필요 없다
        val needAudio = video == null || video.kind == MediaStream.Kind.VIDEO_ONLY
        audioNote = when {
            audioLanguage == AudioLanguage.ORIGINAL -> null
            wanted == null -> "${audioLanguage.label} 소리가 없어 원래 언어로 저장"
            dubbed && !needAudio -> "이 화질에선 ${audioLanguage.label} 소리를 붙일 수 없어 원래 언어로 저장"
            else -> null
        }
        if (video == null && audio == null) throw SaveException("저장할 수 있는 스트림을 찾지 못했어요")
        if (needAudio && audio == null) throw SaveException("소리 스트림을 찾지 못했어요")

        val dir = Library.dirFor(context, id)
        dir.deleteRecursively()
        dir.mkdirs()
        try {
            val videoFile = video?.let { File(dir, "video.${it.ext}") }
            val audioFile = if (needAudio) File(dir, "audio.${audio!!.ext}") else null

            val videoLen = video?.contentLength ?: -1L
            val audioLen = if (needAudio) audio?.contentLength ?: -1L else 0L
            val total = if (videoLen >= 0 && audioLen >= 0) videoLen + audioLen else 0L
            var finished = 0L
            val report = { bytes: Long -> onProgress(Progress(title, finished + bytes, total)) }

            if (video != null && videoFile != null) {
                download(video.url, videoFile, info.userAgent, report)
                finished += videoFile.length()
            }
            if (audioFile != null) {
                download(audio!!.url, audioFile, info.userAgent, report)
            }

            val thumbFile = File(dir, "thumb.jpg")
            val thumb = info.thumbnailUrl
            val hasThumb = thumb != null && runCatching { downloadSimple(thumb, thumbFile) }.isSuccess

            // 자막은 실패해도 영상 저장은 그대로 완료
            val subs = if (withSubtitles) {
                runCatching {
                    SubtitleSaver.save(dir, info.captions, title) { onProgress(Progress(title, 0, 0, it)) }
                }.onFailure { if (it is CancellationException) throw it }.getOrNull()
            } else null

            Library.writeMeta(
                SavedVideo(
                    id = id,
                    title = title,
                    uploader = info.uploader,
                    durationSec = info.durationSec,
                    quality = (if (video == null) "소리만" else "${video.height}p") +
                        (if (dubbed && needAudio) " · ${audioLanguage.label}" else ""),
                    savedAt = System.currentTimeMillis(),
                    dir = dir,
                    videoFile = videoFile,
                    audioFile = audioFile,
                    thumbFile = if (hasThumb) thumbFile else null,
                    subKo = subs?.ko,
                    subOrig = subs?.orig,
                    subOrigLang = subs?.origLang.orEmpty(),
                )
            )
            Library.find(context, id) ?: throw SaveException("저장된 파일을 읽지 못했어요")
        } catch (e: Throwable) {
            dir.deleteRecursively()
            throw e
        }
    }

    /** 이미 저장한 영상에 한국어 자막만 새로 받아 붙인다. */
    suspend fun addSubtitles(
        context: Context,
        video: SavedVideo,
        onProgress: (Progress) -> Unit,
    ): SavedVideo = withContext(Dispatchers.IO) {
        onProgress(Progress(video.title, 0, 0, "자막 정보 가져오는 중…"))
        val info = fetchInfo(video.id)
        if (info.captions.isEmpty()) throw SaveException("이 영상에는 유튜브 자막이 없어요")
        val subs = SubtitleSaver.save(video.dir, info.captions, video.title) {
            onProgress(Progress(video.title, 0, 0, it))
        }
        if (subs.ko == null) throw SaveException("한국어 자막을 만들지 못했어요")
        Library.writeMeta(
            video.copy(subKo = subs.ko, subOrig = subs.orig, subOrigLang = subs.origLang)
        )
        Library.find(context, video.id) ?: video
    }

    /** 저장된 원어 자막을 다시 번역 (유튜브 접속 없음). useClaude=false면 구글 번역 */
    suspend fun retranslate(
        context: Context,
        video: SavedVideo,
        useClaude: Boolean,
        onProgress: (Progress) -> Unit,
    ): SavedVideo = withContext(Dispatchers.IO) {
        if (useClaude && !AiSettings.isReady(context)) throw SaveException("AI 번역 설정(API 키)이 필요해요")
        val ko = try {
            val status = { s: String -> onProgress(Progress(video.title, 0, 0, s)) }
            if (useClaude) SubtitleSaver.retranslateWithAi(video, status)
            else SubtitleSaver.retranslateWithGoogle(video, status)
        } catch (e: SaveException) {
            throw e
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            val engine = if (useClaude) "Claude" else "구글 번역"
            throw SaveException("$engine 실패: ${e.message ?: e.javaClass.simpleName}", e)
        }
        Library.writeMeta(video.copy(subKo = ko))
        Library.find(context, video.id) ?: video
    }

    private fun fetchInfo(id: String): VideoInfo = try {
        VideoSource.fetch(id)
    } catch (e: Exception) {
        throw SaveException(describe(e), e)
    }

    /** 마지막 저장에서 고른 소리 언어를 못 찾았을 때 안내 */
    @Volatile
    var audioNote: String? = null

    /**
     * lang이 비어 있으면 원래 언어 트랙, 아니면 그 언어 트랙(원래 언어가 그 언어인 경우 포함).
     * 해당 언어가 없으면 null.
     */
    private fun pickAudio(streams: List<MediaStream>, lang: String): MediaStream? {
        val audio = streams.filter { it.kind == MediaStream.Kind.AUDIO }
        val candidates = if (lang.isEmpty()) {
            // 더빙 트랙이 여러 개인 영상은 원본 언어 트랙을 우선
            audio.filter { it.originalAudio }.ifEmpty { audio }
        } else {
            audio.filter { it.audioLang == lang }
                .ifEmpty { return null }
        }
        return candidates.filter { it.ext == "m4a" }.maxByOrNull { it.bitrate }
            ?: candidates.maxByOrNull { it.bitrate }
    }

    private fun pickVideo(
        streams: List<MediaStream>,
        maxHeight: Int,
        requireVideoOnly: Boolean = false,
    ): MediaStream? {
        val byQuality = compareBy<MediaStream>({ it.height }, { it.bitrate })
        val videoOnly = streams.filter { it.kind == MediaStream.Kind.VIDEO_ONLY }
        val muxed = if (requireVideoOnly) emptyList() else streams.filter { it.kind == MediaStream.Kind.MUXED }

        // 1) 거의 모든 폰이 하드웨어로 재생하는 H.264(MP4)
        videoOnly.filter { it.isAvc && it.height in 1..maxHeight }.maxWithOrNull(byQuality)
            ?.let { return it }
        // 2) 소리가 같이 들어 있는 일반 MP4
        muxed.filter { it.height in 1..maxHeight }.maxWithOrNull(byQuality)?.let { return it }
        // 3) 그 외(VP9 등). AV1은 지원하지 않는 기기가 많아 제외
        videoOnly.filter { !it.isAv1 && it.height in 1..maxHeight }.maxWithOrNull(byQuality)
            ?.let { return it }
        // 4) 원하는 화질 이하가 없으면 가장 낮은 화질
        return (videoOnly.filter { it.isAvc } + muxed).minWithOrNull(byQuality)
            ?: videoOnly.filter { !it.isAv1 }.minWithOrNull(byQuality)
    }

    /** 유튜브 서버가 한 번에 큰 요청을 끊는 경우가 있어 구간(Range)으로 나눠 받는다. */
    private suspend fun download(url: String, file: File, userAgent: String, onBytes: (Long) -> Unit) {
        var pos = 0L
        var total = -1L
        val buffer = ByteArray(64 * 1024)
        FileOutputStream(file).use { out ->
            while (total < 0 || pos < total) {
                var attempt = 0
                while (true) {
                    coroutineContext.ensureActive()
                    try {
                        val request = Request.Builder()
                            .url(url)
                            .header("User-Agent", userAgent)
                            .header("Range", "bytes=$pos-${pos + CHUNK - 1}")
                            .build()
                        App.http.newCall(request).execute().use { resp ->
                            if (resp.code != 200 && resp.code != 206) {
                                throw IOException("HTTP ${resp.code}")
                            }
                            if (total < 0) {
                                total = resp.header("Content-Range")?.substringAfterLast('/')
                                    ?.toLongOrNull()
                                    ?: resp.body?.contentLength()?.takeIf { it >= 0 }
                                    ?: throw IOException("파일 크기를 알 수 없어요")
                            }
                            if (resp.code == 200 && pos > 0) {
                                throw IOException("서버가 이어받기를 지원하지 않아요")
                            }
                            val input = resp.body!!.byteStream()
                            while (true) {
                                coroutineContext.ensureActive()
                                val n = input.read(buffer)
                                if (n < 0) break
                                out.write(buffer, 0, n)
                                pos += n
                                onBytes(pos)
                            }
                        }
                        break
                    } catch (e: IOException) {
                        if (++attempt >= 5) throw SaveException(describe(e), e)
                        delay(1500L * attempt)
                    }
                }
            }
        }
    }

    private fun downloadSimple(url: String, file: File) {
        val request = Request.Builder().url(url).header("User-Agent", NetDownloader.USER_AGENT).build()
        App.http.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("HTTP ${resp.code}")
            file.outputStream().use { resp.body!!.byteStream().copyTo(it) }
        }
    }

    /** 유튜브가 reCAPTCHA를 요구했다면 확인 페이지 주소 */
    fun captchaUrl(e: Throwable): String? {
        var t: Throwable? = e
        while (t != null) {
            if (t is ReCaptchaException) return t.url ?: "https://www.youtube.com"
            t = t.cause
        }
        return null
    }

    /** 유튜브가 IP를 막고 로그인을 요구한 경우 */
    fun isBotBlock(e: Throwable): Boolean =
        generateSequence(e) { it.cause }.any { it is SignInConfirmNotBotException }

    /** 원인 추적용 자세한 오류 (예외 종류와 유튜브가 준 사유) */
    fun detail(e: Throwable): String {
        val chain = generateSequence(e) { it.cause }.take(5).toList()
        val main = chain.filterNot { it is AllClientsFailedException }
            .joinToString("\n← ") { "${it.javaClass.simpleName}: ${it.message ?: ""}" }
        // 대체 클라이언트(TV, 퍼가기, VR)로 다시 시도한 결과
        val attempts = chain.filterIsInstance<AllClientsFailedException>()
            .flatMap { it.attempts }
            .joinToString("") { "\n+ $it" }
        val login = if (YouTubeAccount.isLoggedIn(App.instance)) "로그인됨" else "로그인 안 함"
        return "앱 버전 ${App.versionName} · $login\n$main$attempts"
    }

    fun describe(e: Throwable): String = when (e) {
        is SaveException -> e.message ?: "저장하지 못했어요"
        is AllClientsFailedException -> describe(e.cause ?: e) + " (TV·퍼가기·VR 방식도 모두 막힘)"
        is AgeRestrictedContentException -> "연령 제한 영상은 로그인 없이 저장할 수 없어요"
        is PrivateContentException -> "비공개 영상이에요"
        is PaidContentException -> "유료(멤버십) 영상은 저장할 수 없어요"
        is GeographicRestrictionException -> "이 지역에서 볼 수 없는 영상이에요"
        is ReCaptchaException ->
            "유튜브가 로봇 확인(reCAPTCHA)을 요구해요. '로봇 확인하기'를 눌러 확인을 마치면 다시 저장돼요"
        is SignInConfirmNotBotException ->
            "유튜브가 지금 쓰는 인터넷(IP)을 로봇으로 의심해 막았어요. " +
                "와이파이↔모바일 데이터를 바꾸거나 VPN을 끄고, 그래도 안 되면 몇 시간 뒤에 다시 시도해 주세요"
        is ContentNotAvailableException -> "볼 수 없는 영상이에요 (${e.message})"
        is UnknownHostException -> "인터넷 연결을 확인해 주세요"
        is IOException -> "네트워크 오류: ${e.message}"
        else -> "저장하지 못했어요: ${e.message ?: e.javaClass.simpleName}"
    }
}
