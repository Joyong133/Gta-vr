package com.joyong.ytsaver

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContract
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import com.google.android.material.appbar.MaterialToolbar
import java.security.MessageDigest

/**
 * 유튜브 로그인 상태. 유튜브가 IP를 막고 "로그인해서 로봇이 아님을 확인하라"고 할 때
 * 로그인한 계정의 쿠키로 요청하면 통과되는 경우가 많다.
 */
object YouTubeAccount {
    private const val KEY = "youtube_cookies"
    private const val ORIGIN = "https://www.youtube.com"

    private fun prefs(context: Context) =
        context.getSharedPreferences("account", Context.MODE_PRIVATE)

    fun cookies(context: Context): String? = prefs(context).getString(KEY, null)

    fun isLoggedIn(context: Context): Boolean = cookies(context)?.let(::hasAuthCookies) == true

    fun save(context: Context, cookies: String) {
        prefs(context).edit().putString(KEY, cookies).apply()
    }

    fun logout(context: Context) {
        prefs(context).edit().remove(KEY).apply()
        CookieManager.getInstance().removeAllCookies(null)
    }

    fun hasAuthCookies(cookies: String): Boolean {
        val map = parse(cookies)
        return "LOGIN_INFO" in map &&
            ("SAPISID" in map || "__Secure-3PAPISID" in map || "__Secure-1PAPISID" in map)
    }

    /** 로그인된 요청에 붙일 헤더 (쿠키 + SAPISIDHASH 인증). 로그인 안 했으면 빈 맵 */
    fun authHeaders(context: Context): Map<String, String> {
        val cookies = cookies(context) ?: return emptyMap()
        val map = parse(cookies)
        val sapisid = map["SAPISID"] ?: map["__Secure-3PAPISID"]
        val auth = listOf(
            "SAPISIDHASH" to sapisid,
            "SAPISID1PHASH" to map["__Secure-1PAPISID"],
            "SAPISID3PHASH" to map["__Secure-3PAPISID"],
        ).mapNotNull { (scheme, sid) -> sid?.let { sidHash(scheme, it) } }
        if (auth.isEmpty()) return emptyMap()
        return mapOf(
            "Cookie" to cookies,
            "Authorization" to auth.joinToString(" "),
            "X-Origin" to ORIGIN,
            "X-Goog-AuthUser" to "0",
            "X-Youtube-Bootstrap-Logged-In" to "true",
        )
    }

    /** "SAPISIDHASH <시각>_<sha1(시각 SID 출처)>" */
    private fun sidHash(scheme: String, sid: String): String {
        val time = (System.currentTimeMillis() / 1000).toString()
        val digest = MessageDigest.getInstance("SHA-1")
            .digest("$time $sid $ORIGIN".toByteArray())
            .joinToString("") { "%02x".format(it) }
        return "$scheme ${time}_$digest"
    }

    private fun parse(cookies: String): Map<String, String> =
        cookies.split(';').mapNotNull { part ->
            val i = part.indexOf('=')
            if (i <= 0) null else part.substring(0, i).trim() to part.substring(i + 1).trim()
        }.toMap()
}

/** 구글 로그인 페이지를 앱 안에서 열고, 로그인이 끝나면 유튜브 쿠키를 저장한다. */
class LoginActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var done = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        val toolbar = MaterialToolbar(this).apply {
            title = "유튜브 로그인"
            subtitle = "부계정 사용을 권장해요"
            setNavigationIcon(R.drawable.ic_close)
            setNavigationOnClickListener { finish() }
        }
        webView = WebView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(toolbar, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.updatePadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().setAcceptCookie(true)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        // 구글은 앱 안 웹뷰 로그인을 막는 경우가 있어 일반 PC 브라우저처럼 보이게 한다
        webView.settings.userAgentString = NetDownloader.USER_AGENT
        if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
            WebSettingsCompat.setRequestedWithHeaderOriginAllowList(webView.settings, emptySet())
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) = check()
        }
        webView.loadUrl(
            "https://accounts.google.com/ServiceLogin?service=youtube&passive=true&hl=ko" +
                "&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue" +
                "%26app%3Ddesktop%26hl%3Dko%26next%3Dhttps%253A%252F%252Fwww.youtube.com%252F"
        )
    }

    private fun check() {
        if (done) return
        val cookies = CookieManager.getInstance().getCookie("https://www.youtube.com") ?: return
        if (!YouTubeAccount.hasAuthCookies(cookies)) return
        done = true
        YouTubeAccount.save(this, cookies)
        Toast.makeText(this, "로그인 완료!", Toast.LENGTH_SHORT).show()
        setResult(RESULT_OK)
        finish()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    class Contract : ActivityResultContract<Unit, Boolean>() {
        override fun createIntent(context: Context, input: Unit) =
            Intent(context, LoginActivity::class.java)

        override fun parseResult(resultCode: Int, intent: Intent?) = resultCode == RESULT_OK
    }
}
