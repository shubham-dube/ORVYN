package app.dubey.orvyn

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

// local_auth (app lock) needs a FragmentActivity for the biometric prompt.
class MainActivity : FlutterFragmentActivity() {
    private var share: MethodChannel? = null
    /** something shared to ORVYN from another app, waiting for the Dart side to take it (lib/drop/drop.dart) */
    private var pending: Map<String, Any?>? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Money capture: while ORVYN is open, new payment notifications are read straight away
        val ch = MoneyListener.bind(flutterEngine.dartExecutor.binaryMessenger, applicationContext)
        MoneyListener.onArrived = { ch.invokeMethod("arrived", null) }
        // Drop: the share sheet
        share = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "orvyn/share").also {
            it.setMethodCallHandler { call, result ->
                if (call.method == "take") {
                    result.success(pending)
                    pending = null
                } else {
                    result.notImplemented()
                }
            }
        }
        receive(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (receive(intent)) share?.invokeMethod("shared", null)
    }

    /** Text and links as they are; an image is copied to the app's own cache so the Dart side can upload it. */
    private fun receive(intent: Intent?): Boolean {
        if (intent?.action != Intent.ACTION_SEND) return false
        val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: intent.getStringExtra(Intent.EXTRA_SUBJECT)
        val uri: Uri? = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }
        var path: String? = null
        var name: String? = null
        val mime = intent.type
        if (uri != null && mime?.startsWith("image/") == true) {
            name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) it.getString(0) else null
            } ?: "shared.jpg"
            val out = File(cacheDir, "share-${System.currentTimeMillis()}")
            contentResolver.openInputStream(uri)?.use { input -> out.outputStream().use { input.copyTo(it) } }
            path = out.absolutePath
        }
        if (text == null && path == null) return false
        pending = mapOf("text" to text, "path" to path, "mime" to mime, "name" to name)
        intent.action = null // handled once
        return true
    }

    override fun onDestroy() {
        MoneyListener.onArrived = null
        super.onDestroy()
    }
}
