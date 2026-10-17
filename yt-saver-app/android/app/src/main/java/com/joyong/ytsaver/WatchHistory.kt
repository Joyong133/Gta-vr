package com.joyong.ytsaver

import android.content.Context

/**
 * 시청 기록. 영상마다 마지막 위치를 기억해 이어보기에 쓰고,
 * 마지막 재생목록(세션)을 저장해 앱이 완전히 꺼졌다 켜져도 복원한다.
 */
object WatchHistory {

    private const val RESUME_MIN_MS = 5_000L
    private const val FINISHED_MARGIN_MS = 5_000L

    data class Entry(val positionMs: Long, val durationMs: Long, val watchedAt: Long) {
        val finished get() = durationMs > 0 && positionMs >= durationMs - FINISHED_MARGIN_MS
        val fraction get() = if (durationMs > 0) (positionMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
    }

    data class Session(val ids: List<String>, val index: Int, val positionMs: Long)

    private fun prefs(context: Context) =
        context.getSharedPreferences("watch_history", Context.MODE_PRIVATE)

    fun get(context: Context, id: String): Entry? {
        val parts = prefs(context).getString("v_$id", null)?.split('|') ?: return null
        if (parts.size != 3) return null
        return Entry(
            parts[0].toLongOrNull() ?: 0, parts[1].toLongOrNull() ?: 0, parts[2].toLongOrNull() ?: 0
        )
    }

    fun save(context: Context, id: String, positionMs: Long, durationMs: Long) {
        if (id.isEmpty() || durationMs <= 0) return
        val pos = positionMs.coerceIn(0, durationMs)
        prefs(context).edit()
            .putString("v_$id", "$pos|$durationMs|${System.currentTimeMillis()}")
            .apply()
    }

    fun markFinished(context: Context, id: String) {
        val entry = get(context, id) ?: return
        save(context, id, entry.durationMs, entry.durationMs)
    }

    /** 다 본 영상이거나 앞부분만 본 경우에는 처음부터 */
    fun resumePosition(context: Context, id: String): Long {
        val entry = get(context, id) ?: return 0
        return if (entry.finished || entry.positionMs < RESUME_MIN_MS) 0 else entry.positionMs
    }

    fun remove(context: Context, id: String) {
        prefs(context).edit().remove("v_$id").apply()
    }

    fun saveSession(context: Context, ids: List<String>, index: Int, positionMs: Long) {
        prefs(context).edit()
            .putString("session_ids", ids.joinToString(","))
            .putInt("session_index", index)
            .putLong("session_pos", positionMs)
            .apply()
    }

    fun loadSession(context: Context): Session? {
        val p = prefs(context)
        val ids = p.getString("session_ids", null)?.split(',')?.filter { it.isNotEmpty() }
        if (ids.isNullOrEmpty()) return null
        return Session(ids, p.getInt("session_index", 0), p.getLong("session_pos", 0))
    }

    fun clearSession(context: Context) {
        prefs(context).edit()
            .remove("session_ids").remove("session_index").remove("session_pos")
            .apply()
    }

    /**
     * 저장된 세션을 보관함 기준으로 되살린다. 그사이 지운 영상은 빼고,
     * 현재 영상이 지워졌으면 다음 영상의 처음부터.
     */
    fun restore(context: Context): Triple<List<SavedVideo>, Int, Long>? {
        val session = loadSession(context) ?: return null
        val videos = session.ids.mapNotNull { Library.find(context, it) }
        if (videos.isEmpty()) return null
        val currentId = session.ids.getOrNull(session.index)
        val index = videos.indexOfFirst { it.id == currentId }
        return if (index >= 0) Triple(videos, index, session.positionMs)
        else Triple(videos, 0, 0L)
    }
}
