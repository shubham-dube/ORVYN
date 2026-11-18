package app.dubey.orvyn

import android.app.Notification
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import io.flutter.FlutterInjector
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import org.json.JSONObject
import java.io.File

/**
 * Money capture (spec 0003, ADR-0012). With the notification access the person turns on, this keeps only payment-looking
 * notifications from SMS apps (bank SMS) and from GPay / PhonePe / Paytm, in a private queue on the phone. The app's
 * Dart reader (lib/money/capture.dart) parses them; only the parsed transaction ever syncs, and the queue entry is
 * removed once saved. Nothing else is read or kept.
 */
class MoneyListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val app = PAY_APPS[sbn.packageName]
        if (app == null && sbn.packageName !in SMS_APPS) return
        val n = sbn.notification ?: return
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val ex = n.extras
        val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val text = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))
            ?.toString() ?: return
        // personal messages are never kept: only text that looks like money moving
        if (!MONEYISH.containsMatchIn(text)) return
        val item = JSONObject()
            .put("source", if (app == null) "sms" else "notification")
            .put("app", app ?: JSONObject.NULL)
            .put("title", title ?: JSONObject.NULL)
            .put("text", text)
            .put("at", sbn.postTime)
        if (!append(this, item)) return
        val open = onArrived
        if (open != null) Handler(Looper.getMainLooper()).post { open() } else runInBackground(applicationContext)
    }

    companion object {
        private val SMS_APPS = setOf(
            "com.google.android.apps.messaging",
            "com.samsung.android.messaging",
            "com.android.mms",
            "com.android.messaging",
            "com.oneplus.mms",
            "com.miui.smsextra",
            "com.coloros.mms",
        )
        private val PAY_APPS = mapOf(
            "com.google.android.apps.nbu.paisa.user" to "gpay",
            "com.phonepe.app" to "phonepe",
            "net.one97.paytm" to "paytm",
        )
        private val MONEYISH = Regex("(?i)(rs\\.?|inr|₹)\\s*[\\d,]+|debited by|credited by")

        /** set by MainActivity while ORVYN is open: it parses right away */
        @Volatile var onArrived: (() -> Unit)? = null
        private var engine: FlutterEngine? = null
        private val recent = ArrayDeque<String>()

        private fun queue(ctx: Context) = File(ctx.noBackupFilesDir, "money_queue.jsonl")

        /** false when it's a repeat (SMS apps re-post the same notification when updating it) */
        @Synchronized fun append(ctx: Context, item: JSONObject): Boolean {
            val key = item.optString("text")
            if (key in recent) return false
            recent.addLast(key)
            while (recent.size > 30) recent.removeFirst()
            queue(ctx).appendText(item.toString() + "\n")
            return true
        }

        @Synchronized fun pending(ctx: Context): List<Map<String, Any?>> {
            val f = queue(ctx)
            if (!f.exists()) return emptyList()
            return f.readLines().filter { it.isNotBlank() }.mapNotNull { line ->
                runCatching {
                    val j = JSONObject(line)
                    mapOf(
                        "source" to j.optString("source", "sms"),
                        "app" to (if (j.isNull("app")) null else j.optString("app")),
                        "title" to (if (j.isNull("title")) null else j.optString("title")),
                        "text" to j.optString("text"),
                        "at" to j.optLong("at"),
                    )
                }.getOrNull()
            }
        }

        @Synchronized fun ack(ctx: Context, count: Int) {
            val f = queue(ctx)
            if (!f.exists()) return
            val rest = f.readLines().filter { it.isNotBlank() }.drop(count)
            if (rest.isEmpty()) f.delete() else f.writeText(rest.joinToString("\n", postfix = "\n"))
        }

        fun enabled(ctx: Context): Boolean =
            Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners")
                ?.contains(ctx.packageName) == true

        /** The channel the Dart side uses, on whichever engine is running (the app's or the background one). */
        fun bind(messenger: BinaryMessenger, ctx: Context): MethodChannel {
            val ch = MethodChannel(messenger, "orvyn/money_capture")
            ch.setMethodCallHandler { call, result ->
                when (call.method) {
                    "enabled" -> result.success(enabled(ctx))
                    "openSettings" -> {
                        ctx.startActivity(
                            Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                        )
                        result.success(null)
                    }
                    "pending" -> result.success(pending(ctx))
                    "ack" -> {
                        ack(ctx, (call.arguments as? Int) ?: 0)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
            return ch
        }

        /** ORVYN isn't open: run the Dart reader once (lib/money/capture.dart moneyCaptureMain), then stop. */
        @Synchronized fun runInBackground(ctx: Context) {
            if (engine != null) return
            val loader = FlutterInjector.instance().flutterLoader()
            loader.startInitialization(ctx)
            loader.ensureInitializationComplete(ctx, null)
            val e = FlutterEngine(ctx)
            engine = e
            bind(e.dartExecutor.binaryMessenger, ctx)
            MethodChannel(e.dartExecutor.binaryMessenger, "orvyn/money_capture_bg").setMethodCallHandler { call, result ->
                result.success(null)
                if (call.method == "done") {
                    Handler(Looper.getMainLooper()).post {
                        synchronized(this) {
                            engine?.destroy()
                            engine = null
                        }
                    }
                }
            }
            e.dartExecutor.executeDartEntrypoint(
                DartExecutor.DartEntrypoint(loader.findAppBundlePath(), "moneyCaptureMain"),
            )
        }
    }
}
