package com.joyong.ytsaver

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.joyong.ytsaver.databinding.ItemVideoBinding
import java.io.File

class VideoAdapter(
    private val onClick: (SavedVideo) -> Unit,
    private val onLongClick: (SavedVideo) -> Unit,
) : RecyclerView.Adapter<VideoAdapter.Holder>() {

    private var items: List<SavedVideo> = emptyList()
    var playingId: String? = null
        set(value) {
            if (field == value) return
            field = value
            notifyDataSetChanged()
        }

    fun submit(list: List<SavedVideo>) {
        items = list
        notifyDataSetChanged()
    }

    override fun getItemCount() = items.size

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        Holder(ItemVideoBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val v = items[position]
        with(holder.b) {
            title.text = v.title
            subtitle.text = listOf(
                v.uploader.takeIf { it.isNotBlank() },
                formatDuration(v.durationSec),
                v.quality,
                formatSize(v.sizeBytes),
            ).filterNotNull().joinToString(" · ")
            thumb.setImageBitmap(v.thumbFile?.let { Thumbs.get(it) })
            badge.visibility = if (v.audioOnly) View.VISIBLE else View.GONE
            playing.visibility = if (v.id == playingId) View.VISIBLE else View.GONE
            root.setOnClickListener { onClick(v) }
            root.setOnLongClickListener { onLongClick(v); true }
        }
    }

    class Holder(val b: ItemVideoBinding) : RecyclerView.ViewHolder(b.root)
}

object Thumbs {
    private val cache = LruCache<String, Bitmap>(40)

    fun get(file: File): Bitmap? {
        cache.get(file.path)?.let { return it }
        val opts = BitmapFactory.Options().apply { inSampleSize = 2 }
        return BitmapFactory.decodeFile(file.path, opts)?.also { cache.put(file.path, it) }
    }
}

fun formatDuration(sec: Long): String? {
    if (sec <= 0) return null
    val h = sec / 3600
    val m = sec % 3600 / 60
    val s = sec % 60
    return if (h > 0) String.format("%d:%02d:%02d", h, m, s) else String.format("%d:%02d", m, s)
}
