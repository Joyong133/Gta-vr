package com.joyong.ytsaver

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContract
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import com.google.android.material.appbar.MaterialToolbar

/** 로봇 확인을 통과하면 받는 유튜브 예외 쿠키를 보관 */
object CaptchaCookies {
    private const val KEY = "abuse_exemption_cookie"

    private fun prefs(context: Context) =
        context.getSharedPreferences("captcha", Context.MODE_PRIVATE)

    fun get(context: Context): String? = prefs(context).getString(KEY, null)

    fun set(context: Context, cookie: String) {
        prefs(context).edit().putString(KEY, cookie).apply()
    }
}

/**
 * 유튜브가 reCAPTCHA를 요구할 때 그 페이지를 앱 안에서 열어 사용자가 직접 확인하게 한다.
 * 확인이 끝나면 구글이 주는 GOOGLE_ABUSE_EXEMPTION 쿠키를 저장해 이후 요청에 붙인다.
 */
class CaptchaActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var found: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        val toolbar = MaterialToolbar(this).apply {
            title = "로봇이 아님을 확인해 주세요"
            subtitle = "확인을 마치면 자동으로 돌아가요"
            setNavigationIcon(R.drawable.ic_close)
            setNavigationOnClickListener { finishWithResult() }
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

        // 이전 쿠키가 남아 있으면 확인 페이지가 꼬일 수 있어 비우고 시작
        CookieManager.getInstance().removeAllCookies(null)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        // 앱이 유튜브에 요청할 때와 같은 브라우저로 보이게 해야 쿠키가 통한다
        webView.settings.userAgentString = NetDownloader.USER_AGENT
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                check(request.url.toString())
                return false
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                check(url)
            }

            override fun onPageFinished(view: WebView, url: String) {
                check(url)
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = finishWithResult()
        })

        val url = intent.getStringExtra(EXTRA_URL).orEmpty()
            .replace("&pbj=1", "").replace("?pbj=1&", "?").replace("?pbj=1", "")
            .ifBlank { "https://www.youtube.com" }
        webView.loadUrl(url)
    }

    /** 쿠키 저장소나 주소(google_abuse=...)에서 예외 쿠키를 찾는다 */
    private fun check(url: String?) {
        if (url.isNullOrEmpty() || found != null) return
        val fromJar = CookieManager.getInstance().getCookie(url)
            ?.split(';')?.map { it.trim() }
            ?.firstOrNull { it.startsWith("GOOGLE_ABUSE_EXEMPTION=") }
        val fromUrl = runCatching { Uri.parse(url).getQueryParameter("google_abuse") }.getOrNull()
            ?.substringBefore(";")?.trim()
            ?.takeIf { it.startsWith("GOOGLE_ABUSE_EXEMPTION=") }
        val cookie = fromJar ?: fromUrl ?: return
        found = cookie
        CaptchaCookies.set(this, cookie)
        Toast.makeText(this, "확인 완료! 다시 저장할게요", Toast.LENGTH_SHORT).show()
        finishWithResult()
    }

    private fun finishWithResult() {
        if (found == null) check(webView.url)
        setResult(if (found != null) RESULT_OK else RESULT_CANCELED)
        webView.stopLoading()
        finish()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    /** registerForActivityResult(CaptchaActivity.Contract()) 로 열고, 통과하면 true */
    class Contract : ActivityResultContract<String, Boolean>() {
        override fun createIntent(context: Context, input: String) =
            Intent(context, CaptchaActivity::class.java).putExtra(EXTRA_URL, input)

        override fun parseResult(resultCode: Int, intent: Intent?) = resultCode == RESULT_OK
    }

    companion object {
        private const val EXTRA_URL = "url"
    }
}
