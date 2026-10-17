package com.joyong.ytsaver

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException

/** NewPipeExtractor가 유튜브 페이지/API를 요청할 때 쓰는 HTTP 구현 */
class NetDownloader(
    private val client: OkHttpClient,
    /** 로봇 확인을 통과해 받은 유튜브 쿠키 (없으면 null) */
    private val cookies: () -> String?,
) : Downloader() {

    override fun execute(request: Request): Response {
        val method = request.httpMethod()
        val body = request.dataToSend()?.toRequestBody()
            ?: if (method in BODY_METHODS) ByteArray(0).toRequestBody() else null

        val builder = okhttp3.Request.Builder()
            .url(request.url())
            .method(method, body)
            .header("User-Agent", USER_AGENT)

        val host = request.url().toHttpUrlOrNull()?.host.orEmpty()
        if (host.endsWith("youtube.com") || host.endsWith("google.com")) {
            cookies()?.let { builder.header("Cookie", it) }
        }

        for ((name, values) in request.headers()) {
            builder.removeHeader(name)
            values.forEach { builder.addHeader(name, it) }
        }

        client.newCall(builder.build()).execute().use { resp ->
            if (resp.code == 429) {
                throw ReCaptchaException("reCaptcha Challenge requested", request.url())
            }
            return Response(
                resp.code,
                resp.message,
                resp.headers.toMultimap(),
                resp.body?.string(),
                resp.request.url.toString()
            )
        }
    }

    companion object {
        private val BODY_METHODS = setOf("POST", "PUT", "PATCH")

        const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0"
    }
}
