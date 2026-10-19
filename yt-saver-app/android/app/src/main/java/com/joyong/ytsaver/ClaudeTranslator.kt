package com.joyong.ytsaver

import android.content.Context
import com.anthropic.client.okhttp.AnthropicOkHttpClient
import com.anthropic.core.JsonValue
import com.anthropic.models.messages.JsonOutputFormat
import com.anthropic.models.messages.MessageCreateParams
import com.anthropic.models.messages.OutputConfig
import com.anthropic.models.messages.StopReason
import kotlinx.coroutines.ensureActive
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import kotlin.coroutines.coroutineContext

/** 자막 번역에 쓸 AI(Claude) 설정. API 키는 이 폰의 앱 저장소에만 보관 */
object AiSettings {
    enum class Model(val id: String, val label: String) {
        OPUS("claude-opus-5-5", "Claude Opus 5.5 (가장 자연스러움)"),
        SONNET("claude-sonnet-5-5", "Claude Sonnet 5.5 (빠르고 절반 가격)"),
        HAIKU("claude-haiku-5-5", "Claude Haiku 5.5 (아주 저렴)"),
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences("ai_settings", Context.MODE_PRIVATE)

    fun apiKey(context: Context): String = prefs(context).getString("api_key", "").orEmpty()

    fun model(context: Context): Model =
        runCatching { Model.valueOf(prefs(context).getString("model", Model.OPUS.name)!!) }
            .getOrDefault(Model.OPUS)

    fun enabled(context: Context): Boolean = prefs(context).getBoolean("enabled", true)

    /** 키가 있고 켜져 있으면 자막 번역에 Claude를 쓴다 */
    fun isReady(context: Context) = enabled(context) && apiKey(context).isNotBlank()

    fun save(context: Context, apiKey: String, model: Model, enabled: Boolean) {
        prefs(context).edit()
            .putString("api_key", apiKey.trim())
            .putString("model", model.name)
            .putBoolean("enabled", enabled)
            .apply()
    }
}

/**
 * Claude로 자막 큐를 한국어로 번역한다. 앞뒤 문맥을 보도록 여러 줄을 한 번에 보내고,
 * 결과는 정해진 JSON 형식(structured output)으로 받아 줄 번호대로 다시 맞춘다.
 */
object ClaudeTranslator {

    private const val BATCH = 120

    private const val SYSTEM = """You translate video subtitles into natural, fluent Korean.

The user message is JSON: the video title, the source language, and an array of subtitle cues, each with an index "i" and text "t". Cues are consecutive lines of one video. Auto-generated captions often split a sentence across several cues; read the surrounding cues so the Korean flows naturally, while keeping each translated cue aligned with the meaning and timing of its own cue.

Write it the way a professional Korean subtitler would: concise, easy to read at a glance, and matching the speaker's tone (casual speech stays casual, formal stays formal). Keep names, numbers and units accurate; keep well-known proper nouns in their usual Korean form. Translate every cue, including short fillers, and return each index exactly once with no commentary."""

    private val schema: JsonOutputFormat.Schema = JsonOutputFormat.Schema.builder()
        .putAdditionalProperty("type", JsonValue.from("object"))
        .putAdditionalProperty(
            "properties", JsonValue.from(
                mapOf(
                    "translations" to mapOf(
                        "type" to "array",
                        "items" to mapOf(
                            "type" to "object",
                            "properties" to mapOf(
                                "i" to mapOf("type" to "integer"),
                                "t" to mapOf("type" to "string"),
                            ),
                            "required" to listOf("i", "t"),
                            "additionalProperties" to false,
                        ),
                    ),
                )
            )
        )
        .putAdditionalProperty("required", JsonValue.from(listOf("translations")))
        .putAdditionalProperty("additionalProperties", JsonValue.from(false))
        .build()

    suspend fun translate(
        context: Context,
        cues: List<SubtitleSaver.Cue>,
        sourceLang: String,
        title: String,
        onStatus: (String) -> Unit,
    ): List<SubtitleSaver.Cue> {
        val model = AiSettings.model(context)
        val client = AnthropicOkHttpClient.builder()
            .apiKey(AiSettings.apiKey(context))
            .build()
        try {
            val out = ArrayList<SubtitleSaver.Cue>(cues.size)
            for (start in cues.indices step BATCH) {
                coroutineContext.ensureActive()
                onStatus("${model.label.substringBefore(" (")}로 번역 중… ${start * 100 / cues.size}%")
                val batch = cues.subList(start, minOf(start + BATCH, cues.size))
                val translated = translateBatch(client, model, batch, sourceLang, title)
                batch.forEachIndexed { i, cue ->
                    out += cue.copy(text = translated[i]?.takeIf { it.isNotBlank() } ?: cue.text)
                }
            }
            return out
        } finally {
            client.close()
        }
    }

    private fun translateBatch(
        client: com.anthropic.client.AnthropicClient,
        model: AiSettings.Model,
        batch: List<SubtitleSaver.Cue>,
        sourceLang: String,
        title: String,
    ): Map<Int, String> {
        val input = JSONObject()
            .put("title", title)
            .put("source_language", sourceLang.ifEmpty { "auto" })
            .put("cues", JSONArray().apply {
                batch.forEachIndexed { i, cue -> put(JSONObject().put("i", i).put("t", cue.text)) }
            })

        val params = MessageCreateParams.builder()
            .model(model.id)
            .maxTokens(16000L)
            .system(SYSTEM)
            .addUserMessage(input.toString())
            .outputConfig(
                OutputConfig.builder()
                    .effort(OutputConfig.Effort.MEDIUM)
                    .format(JsonOutputFormat.builder().schema(schema).build())
                    .build()
            )
            .apply {
                // 안전 분류기가 거절하면 서버가 다른 모델로 자동 재시도 (Haiku는 미지원)
                if (model != AiSettings.Model.HAIKU) {
                    putAdditionalHeader("anthropic-beta", "server-side-fallback-2026-07-01")
                    putAdditionalBodyProperty("fallbacks", JsonValue.from("default"))
                }
            }
            .build()

        val response = client.messages().create(params)
        val stop = response.stopReason().orElse(null)
        if (stop == StopReason.REFUSAL) throw IOException("Claude가 이 자막 번역을 거절했어요")
        if (stop == StopReason.MAX_TOKENS) throw IOException("번역 결과가 너무 길어 잘렸어요")

        val text = response.content().mapNotNull { it.text().orElse(null)?.text() }.joinToString("")
        val arr = JSONObject(text).optJSONArray("translations") ?: throw IOException("번역 결과 형식 오류")
        return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
            .associate { it.optInt("i", -1) to it.optString("t") }
    }
}
