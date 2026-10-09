package com.joyong.nihongo;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 일본어 마스터 — 웹 기반 학습 화면(assets)을 WebView로 띄우고,
 * 음성(TTS)·음성 인식·진동·화면 켜짐 유지·학습 알림·백업 파일 저장 기능을 JS에 제공한다.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String START_URL = "https://" + HOST + "/index.html";
    private static final int REQ_SPEECH = 7001;
    private static final int REQ_SAVE_BACKUP = 7002;
    private static final int REQ_OPEN_BACKUP = 7003;
    private static final int REQ_NOTIFY = 7004;

    private FrameLayout root;
    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private boolean ttsWarned = false;
    private int pendingSpeechId = 0;
    private String pendingBackup = null;
    private boolean darkBars = false;

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "application/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("svg", "image/svg+xml");
        MIME.put("woff2", "font/woff2");
        MIME.put("ttf", "font/ttf");
        MIME.put("mp3", "audio/mpeg");
        MIME.put("ico", "image/x-icon");
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        root = new FrameLayout(this);
        root.setBackgroundColor(night ? 0xFF0E1120 : 0xFFF5F6FB);
        web = new WebView(this);
        web.setBackgroundColor(night ? 0xFF0E1120 : 0xFFF5F6FB);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        setupInsets();
        applyBars(night);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                return serveAsset(u.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException ignored) {
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "NativeApp");
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        if (web.getUrl() == null) web.loadUrl(START_URL);

        tts = new TextToSpeech(this, status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) tts.setLanguage(Locale.JAPAN);
        });
    }

    private WebResourceResponse serveAsset(String path) {
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        String p = path.startsWith("/") ? path.substring(1) : path;
        if (p.contains("..")) return notFound();
        String ext = p.contains(".") ? p.substring(p.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "";
        String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
        try {
            InputStream in = getAssets().open(p);
            WebResourceResponse r = new WebResourceResponse(mime, "UTF-8", in);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            headers.put("Access-Control-Allow-Origin", "*");
            r.setResponseHeaders(headers);
            return r;
        } catch (IOException e) {
            return notFound();
        }
    }

    private WebResourceResponse notFound() {
        WebResourceResponse r = new WebResourceResponse("text/plain", "UTF-8", new java.io.ByteArrayInputStream(new byte[0]));
        r.setStatusCodeAndReasonPhrase(404, "Not Found");
        return r;
    }

    /* Android 15(대상 SDK 35)는 화면을 시스템 바 뒤까지 그리므로, 바 높이만큼 여백을 준다. */
    private void setupInsets() {
        if (Build.VERSION.SDK_INT < 35) return;
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsets.CONSUMED;
        });
    }

    @SuppressWarnings("deprecation")
    private void applyBars(boolean dark) {
        darkBars = dark;
        int bg = dark ? 0xFF0E1120 : 0xFFF5F6FB;
        root.setBackgroundColor(bg);
        Window w = getWindow();
        if (Build.VERSION.SDK_INT < 35) {
            w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            w.setStatusBarColor(bg);
            w.setNavigationBarColor(dark ? 0xFF171B2D : Color.WHITE);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(dark ? 0 : mask, mask);
            }
        } else {
            View d = w.getDecorView();
            int flags = d.getSystemUiVisibility();
            int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) light |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            d.setSystemUiVisibility(dark ? (flags & ~light) : (flags | light));
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("(window.App && App.handleBack) ? App.handleBack() : 'false'", value -> {
            if (value == null || !value.contains("true")) moveTaskToBack(true);
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.evaluateJavascript("window.App && App.onResume && App.onResume()", null);
        }
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.evaluateJavascript("window.App && App.store && App.store.state && App.store.flush()", null);
            web.onPause();
        }
        if (tts != null) tts.stop();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_SPEECH) {
            ArrayList<String> list = (resultCode == RESULT_OK && data != null) ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
            JSONArray arr = new JSONArray();
            if (list != null) for (String x : list) arr.put(x);
            String json = JSONObject.quote(arr.toString());
            web.evaluateJavascript("App.speech._onResult(" + pendingSpeechId + ", " + json + ")", null);
        } else if (requestCode == REQ_SAVE_BACKUP) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingBackup != null) {
                try (OutputStream os = getContentResolver().openOutputStream(data.getData(), "wt")) {
                    if (os != null) os.write(pendingBackup.getBytes(StandardCharsets.UTF_8));
                    toast("백업 파일을 저장했어요");
                } catch (Exception e) {
                    toast("저장 실패: " + e.getMessage());
                }
            }
            pendingBackup = null;
        } else if (requestCode == REQ_OPEN_BACKUP) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                try (InputStream in = getContentResolver().openInputStream(data.getData())) {
                    String text = readAll(in);
                    web.evaluateJavascript("App.importBackup && App.importBackup(" + JSONObject.quote(text) + ")", null);
                } catch (Exception e) {
                    toast("불러오기 실패: " + e.getMessage());
                }
            }
        }
    }

    private static String readAll(InputStream in) throws IOException {
        if (in == null) return "";
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        return new String(bo.toByteArray(), StandardCharsets.UTF_8);
    }

    private void toast(String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show());
    }

    /** JS에서 window.NativeApp 으로 접근 */
    class Bridge {
        @JavascriptInterface
        public void speak(String text, float rate, String lang) {
            if (!ttsReady || tts == null) {
                if (!ttsWarned) {
                    ttsWarned = true;
                    toast("음성 엔진을 준비 중이에요. 잠시 후 다시 눌러 주세요");
                }
                return;
            }
            Locale loc = (lang == null || lang.isEmpty()) ? Locale.JAPAN : Locale.forLanguageTag(lang);
            int res = tts.setLanguage(loc);
            if ((res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) && loc.getLanguage().equals("ja")) {
                if (!ttsWarned) {
                    ttsWarned = true;
                    toast("일본어 음성 데이터가 없어요. 설정 → TTS 엔진에서 일본어를 설치해 주세요");
                }
                return;
            }
            tts.setSpeechRate(Math.max(0.3f, Math.min(2.0f, rate)));
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "u" + System.nanoTime());
        }

        @JavascriptInterface
        public void stopSpeak() {
            if (tts != null) tts.stop();
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public void vibrate(int ms) {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(Math.max(1, ms), VibrationEffect.DEFAULT_AMPLITUDE));
            else v.vibrate(ms);
        }

        @JavascriptInterface
        public void keepScreenOn(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public void setDarkStatusBar(boolean dark) {
            runOnUiThread(() -> {
                applyBars(dark);
                web.setBackgroundColor(dark ? 0xFF0E1120 : 0xFFF5F6FB);
            });
        }

        @JavascriptInterface
        public void saveState(String json) {
            File dir = getFilesDir();
            File tmp = new File(dir, "state.json.tmp");
            File dst = new File(dir, "state.json");
            try (FileOutputStream os = new FileOutputStream(tmp)) {
                os.write(json.getBytes(StandardCharsets.UTF_8));
                os.getFD().sync();
            } catch (IOException e) {
                return;
            }
            //noinspection ResultOfMethodCallIgnored
            tmp.renameTo(dst);
        }

        @JavascriptInterface
        public String loadState() {
            File f = new File(getFilesDir(), "state.json");
            if (!f.exists()) return null;
            try (FileInputStream in = new FileInputStream(f)) {
                return readAll(in);
            } catch (IOException e) {
                return null;
            }
        }

        @JavascriptInterface
        public boolean speechAvailable() {
            try {
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                return SpeechRecognizer.isRecognitionAvailable(MainActivity.this)
                        || !getPackageManager().queryIntentActivities(i, 0).isEmpty();
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void startSpeech(int id, String lang) {
            runOnUiThread(() -> {
                pendingSpeechId = id;
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
                i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
                i.putExtra(RecognizerIntent.EXTRA_PROMPT, "일본어로 읽어 주세요");
                try {
                    startActivityForResult(i, REQ_SPEECH);
                } catch (ActivityNotFoundException e) {
                    toast("이 기기에서는 음성 인식을 사용할 수 없어요");
                    web.evaluateJavascript("App.speech._onResult(" + id + ", '[]')", null);
                }
            });
        }

        @JavascriptInterface
        public void setReminder(int hour, int minute) {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
                }
                ReminderReceiver.save(MainActivity.this, hour, minute);
                ReminderReceiver.schedule(MainActivity.this);
            });
        }

        @JavascriptInterface
        public void cancelReminder() {
            ReminderReceiver.save(MainActivity.this, -1, -1);
            ReminderReceiver.cancel(MainActivity.this);
        }

        @JavascriptInterface
        public void shareText(String title, String text) {
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_SUBJECT, title);
                send.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(send, title));
            });
        }

        @JavascriptInterface
        public void saveBackupFile(String fileName, String json) {
            runOnUiThread(() -> {
                pendingBackup = json;
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("application/json");
                i.putExtra(Intent.EXTRA_TITLE, fileName);
                try {
                    startActivityForResult(i, REQ_SAVE_BACKUP);
                } catch (ActivityNotFoundException e) {
                    shareText(fileName, json);
                }
            });
        }

        @JavascriptInterface
        public void openBackupFile() {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(i, REQ_OPEN_BACKUP);
                } catch (ActivityNotFoundException e) {
                    toast("파일 선택기를 열 수 없어요");
                }
            });
        }

        @JavascriptInterface
        public void openTtsSettings() {
            runOnUiThread(() -> {
                try {
                    Intent i = new Intent("com.android.settings.TTS_SETTINGS");
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) {
                    try {
                        startActivity(new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA));
                    } catch (Exception e2) {
                        toast("TTS 설정을 열 수 없어요");
                    }
                }
            });
        }

        @JavascriptInterface
        public String appVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }
    }
}
