package com.joyong.ytsaver

import android.content.Context
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import org.json.JSONObject
import java.io.File

data class SavedVideo(
    val id: String,
    val title: String,
    val uploader: String,
    val durationSec: Long,
    val quality: String,
    val savedAt: Long,
    val dir: File,
    val videoFile: File?,
    val audioFile: File?,
    val thumbFile: File?,
    /** 한국어 자막(원래 한국어이거나 번역한 것) */
    val subKo: File? = null,
    /** 번역 전 원어 자막 */
    val subOrig: File? = null,
    val subOrigLang: String = "",
) {
    val audioOnly get() = videoFile == null
    val sizeBytes get() = (videoFile?.length() ?: 0L) + (audioFile?.length() ?: 0L)

    fun toMediaItem(): MediaItem {
        val main = videoFile ?: audioFile!!
        return MediaItem.Builder()
            .setMediaId(id)
            .setUri(Uri.fromFile(main))
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(title)
                    .setArtist(uploader)
                    .setArtworkUri(thumbFile?.let { Uri.fromFile(it) })
                    .build()
            )
            .build()
    }
}

/**
 * 저장된 영상 보관함. 영상마다 videos/<유튜브 ID>/ 폴더를 쓰고,
 * 다운로드가 끝까지 끝난 경우에만 meta.json을 기록한다.
 */
object Library {

    private const val META = "meta.json"

    fun root(context: Context): File =
        File(context.getExternalFilesDir(null) ?: context.filesDir, "videos").apply { mkdirs() }

    fun dirFor(context: Context, id: String) = File(root(context), id)

    fun list(context: Context): List<SavedVideo> =
        root(context).listFiles().orEmpty()
            .mapNotNull { load(it) }
            .sortedByDescending { it.savedAt }

    fun find(context: Context, id: String): SavedVideo? =
        if (id.isEmpty()) null else load(dirFor(context, id))

    fun delete(video: SavedVideo) {
        video.dir.deleteRecursively()
    }

    fun writeMeta(video: SavedVideo) {
        val json = JSONObject()
            .put("id", video.id)
            .put("title", video.title)
            .put("uploader", video.uploader)
            .put("durationSec", video.durationSec)
            .put("quality", video.quality)
            .put("savedAt", video.savedAt)
            .put("video", video.videoFile?.name ?: "")
            .put("audio", video.audioFile?.name ?: "")
            .put("thumb", video.thumbFile?.name ?: "")
            .put("subKo", video.subKo?.name ?: "")
            .put("subOrig", video.subOrig?.name ?: "")
            .put("subOrigLang", video.subOrigLang)
        val tmp = File(video.dir, "$META.tmp")
        tmp.writeText(json.toString())
        tmp.renameTo(File(video.dir, META))
    }

    private fun load(dir: File): SavedVideo? {
        val meta = File(dir, META)
        if (!meta.isFile) return null
        return try {
            val json = JSONObject(meta.readText())
            fun file(key: String) = json.optString(key).takeIf { it.isNotEmpty() }
                ?.let { File(dir, it) }?.takeIf { it.isFile }
            val video = file("video")
            val audio = file("audio")
            if (video == null && audio == null) return null
            SavedVideo(
                id = json.getString("id"),
                title = json.optString("title"),
                uploader = json.optString("uploader"),
                durationSec = json.optLong("durationSec"),
                quality = json.optString("quality"),
                savedAt = json.optLong("savedAt"),
                dir = dir,
                videoFile = video,
                audioFile = audio,
                thumbFile = file("thumb"),
                subKo = file("subKo"),
                subOrig = file("subOrig"),
                subOrigLang = json.optString("subOrigLang"),
            )
        } catch (e: Exception) {
            null
        }
    }
}
