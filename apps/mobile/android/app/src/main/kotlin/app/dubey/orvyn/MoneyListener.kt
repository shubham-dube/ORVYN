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
    /**
     * Connected (again): Android drops the listener when it kills the app or after an update, and connects it again
     * later. What arrived meanwhile is still in the shade, so it is read now instead of being missed.
     */
    override fun onListenerConnected() {
        super.onListenerConnected()
        runCatching { activeNotifications?.forEach { keep(it) } }
        if (pending(this).isNotEmpty()) wake(applicationContext)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (keep(sbn)) wake(applicationContext)
    }

    /** true when it is new money news, now in the queue */
    private fun keep(sbn: StatusBarNotification): Boolean {
        val pkg = sbn.packageName
        if (pkg == packageName || pkg in NEVER) return false
        val app = PAY_APPS[pkg]
        val known = app != null || pkg in SMS_APPS
        val n = sbn.notification ?: return false
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return false
        val ex = n.extras
        val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val text = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))
            ?.toString() ?: return false
        // personal messages are never kept: only text that looks like money moving; from an app ORVYN doesn't know
        // (Truecaller, a bank's own app, SMS Organizer…) it must also say what happened to the money
        if (!MONEYISH.containsMatchIn(text)) return false
        if (!known && !MOVED.containsMatchIn(text)) return false
        val item = JSONObject()
            .put("source", if (app == null) "sms" else "notification")
            .put("app", app ?: JSONObject.NULL)
            .put("title", title ?: JSONObject.NULL)
            .put("text", text)
            .put("at", sbn.postTime)
        return append(this, item)
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
        /** chats and mail: people write amounts there, banks don't (mail has its own place in ORVYN) */
        private val NEVER = setOf(
            "com.whatsapp", "com.whatsapp.w4b", "org.telegram.messenger", "com.instagram.android",
            "com.facebook.orca", "org.thoughtcrime.securesms", "com.google.android.gm", "com.microsoft.office.outlook",
            "com.discord", "com.slack", "com.google.android.apps.dynamite",
        )
        private val MONEYISH = Regex("(?i)(rs\\.?|inr|₹)\\s*[\\d,]+|debited by|credited by")
        private val MOVED = Regex(
            "(?i)\\b(debited|credited|spent|paid|sent|received|withdrawn|deposited|txn|transaction|upi|a/c|acct)\\b",
        )

        /** set by MainActivity while ORVYN is open: it parses right away */
        @Volatile var onArrived: (() -> Unit)? = null
        private var engine: FlutterEngine? = null
        private val recent = ArrayDeque<String>()

        private fun queue(ctx: Context) = File(ctx.noBackupFilesDir, "money_queue.jsonl")

        /** false when it's a repeat (SMS apps re-post the same notification when updating it) */
        /** Read the queue now: in the open app, or with the background reader. */
        fun wake(ctx: Context) {
            val open = onArrived
            if (open != null) Handler(Looper.getMainLooper()).post { open() } else runInBackground(ctx)
        }

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
            if (engine != null) {
                again = true // read once more when this run ends: it may have read the queue before this arrived
                return
            }
            again = false
            val loader = FlutterInjector.instance().flutterLoader()
            loader.startInitialization(ctx)
            loader.ensureInitializationComplete(ctx, null)
            val e = FlutterEngine(ctx)
            engine = e
            bind(e.dartExecutor.binaryMessenger, ctx)
            MethodChannel(e.dartExecutor.binaryMessenger, "orvyn/money_capture_bg").setMethodCallHandler { call, result ->
                result.success(null)
                if (call.method == "done") end(ctx, e)
            }
            // a run that never says done (no network, a stuck call) must not stop every payment after it
            Handler(Looper.getMainLooper()).postDelayed({ end(ctx, e) }, RUN_MAX_MS)
            e.dartExecutor.executeDartEntrypoint(
                DartExecutor.DartEntrypoint(loader.findAppBundlePath(), "package:orvyn/money/capture.dart", "moneyCaptureMain"),
            )
        }

        private const val RUN_MAX_MS = 60_000L
        @Volatile private var again = false

        private fun end(ctx: Context, e: FlutterEngine) {
            Handler(Looper.getMainLooper()).post {
                val more = synchronized(this) {
                    if (engine !== e) return@post
                    e.destroy()
                    engine = null
                    again && pending(ctx).isNotEmpty()
                }
                if (more) runInBackground(ctx)
            }
        }
    }
}
